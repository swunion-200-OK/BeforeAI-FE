import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { USE_MOCK } from "../../api/client";
import { approvalsApi, meApi } from "../../api/endpoints";
import { ApiError, errorMessage } from "../../api/errors";
import type {
  Plan,
  RequestDetail,
  RequestStatus,
  SubmitApprovalResponse,
  Task,
  TaskApprovalStatus,
} from "../../api/types";
import { useMe } from "../../app/AuthProvider";
import {
  ApprovalStamps,
  approvalSummary,
} from "../../components/ApprovalStamps";
import { RequestStatusBadge } from "../../components/badges";
import { KeyValues } from "../../components/rich";
import { TaskCard, TaskRows } from "../../components/TaskCard";
import { toast } from "../../components/toast";
import {
  Banner,
  Button,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Mono,
  ReasonModal,
  Spinner,
} from "../../components/ui";
import { deviceStore } from "../../crypto/deviceStore";
import { signingService } from "../../crypto/signingService";
import { useApprovalStatuses } from "../../lib/approvalStatus";
import { formatDateTime } from "../../lib/format";
import { isRequestEnded } from "../../lib/settledTask";
import { taskNumber } from "../../lib/taskLabel";
import { executionDeferredText } from "../requests/statusBannerText";
import { REQUEST_STATUS_LABEL, SOURCE_LABEL } from "../../lib/labels";
import {
  useDepartmentNames,
  useIsExternal,
  useProjects,
  useRefreshAll,
  useRequest,
} from "../../lib/queries";
import {
  signAndSubmitApproval,
  verifyIntegrity,
  type SignStep,
} from "./approvalFlow";
import { ProgressSection } from "../progress/ProgressTree";
import { IntegrityCheck } from "./IntegrityCheck";
import { SignProgress, type SignRunState } from "./SignProgress";

/** 단계가 눈에 보이도록 시연용으로 잠깐씩 멈춘다. 실제 서명을 일부러 늦추지는 않는다. */
const STEP_DELAY_MS = USE_MOCK ? 350 : 0;
/** 웹쉘이 실행을 시작한 뒤의 상태 */
const EXECUTION_STARTED: RequestStatus[] = [
  "RUNNING",
  "KILLED",
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "FAILED",
  "ROLLING_BACK",
  "ROLLED_BACK",
  "ROLLBACK_FAILED",
];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type DecisionKind = "reject" | "change";

/** 조용한 메타 한 줄. 누르면 저장소·기준 커밋·해시가 펼쳐진다. */
function RequestMeta({
  request,
  plan,
  planHash,
  taskCount,
}: {
  request: RequestDetail;
  plan: Pick<Plan, "kind" | "repository" | "baseCommit"> | null | undefined;
  planHash: string | undefined;
  taskCount: number;
}) {
  const departmentName = useDepartmentNames();
  const projects = useProjects();
  // 프로젝트 이름은 서버의 요청 응답에 없어 프로젝트 목록에서 찾는다.
  const parts = [
    request.requester.name,
    projects.data?.find((project) => project.id === request.projectId)?.name ??
      request.projectId,
    `작업 ${taskCount}개`,
  ];
  // 롤백인지, 에디터에서 온 요청인지는 승인 판단에 필요해서 접지 않는다.
  if (plan?.kind === "ROLLBACK") parts.push("문서 롤백 Plan");
  else if (request.source !== "PROMPT")
    parts.push(SOURCE_LABEL[request.source]);
  return (
    <details className="group mt-2">
      <summary className="inline-flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-3 hover:text-ink-2 [&::-webkit-details-marker]:hidden">
        {request.status !== "PENDING_APPROVAL" && (
          <RequestStatusBadge status={request.status} />
        )}
        <span>{parts.join(", ")}</span>
        <span className="inline-flex items-center gap-0.5">
          Plan 자세히
          <ChevronDown
            size={14}
            className="transition-transform group-open:rotate-180"
            aria-hidden
          />
        </span>
      </summary>
      <div className="mt-2.5">
        <KeyValues
          items={[
            {
              label: "요청자 부서",
              value: departmentName(request.requester.departmentId),
            },
            { label: "요청 시각", value: formatDateTime(request.createdAt) },
            ...(plan
              ? [
                  { label: "저장소", value: <Mono>{plan.repository}</Mono> },
                  { label: "기준 커밋", value: <Mono>{plan.baseCommit}</Mono> },
                ]
              : []),
            ...(planHash
              ? [{ label: "Plan 해시", value: <Mono>{planHash}</Mono> }]
              : []),
          ]}
        />
      </div>
    </details>
  );
}

/** 카드 아래 안내는 체크할 수 없는 이유가 있을 때만 쓴다. 나머지는 체크박스와 결재란이 말해 준다. */
function taskNote(
  task: Task,
  approvable: boolean,
  blocked: boolean,
  status: TaskApprovalStatus | undefined,
): ReactNode {
  if (blocked)
    return (
      <p className="text-sm font-medium text-external">내부망 승인 필요</p>
    );
  if (!status || approvable || task.status !== "PENDING") return undefined;
  return <p className="text-sm text-ink-2">{approvalSummary(status)}</p>;
}

function NoPlanNotice({ requestId }: { requestId: string }) {
  return (
    <Banner
      tone="info"
      title="아직 승인할 수 없는 요청입니다"
      action={
        <Link to={`/requests/${requestId}`} className="font-medium underline">
          요청 상세 보기
        </Link>
      }
    >
      요청자가 Plan을 제출하면 승인할 수 있습니다.
    </Banner>
  );
}

/** 결재가 끝났을 때 찍히는 큰 도장 */
function ResultSeal({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="animate-stamp inline-flex size-[4.25rem] shrink-0 -rotate-6 items-center justify-center rounded-full border-[3px] border-stamp text-stamp"
    >
      <span className="text-lg font-bold tracking-tight">{label}</span>
    </span>
  );
}

/** 이번에 실제로 제출한 서명. 이 작업의 칸에만 도장이 찍히고, 이미 있던 도장은 움직이지 않는다. */
interface JustStamped {
  userId: string;
  taskIds: string[];
}

function StampSheet({
  statuses,
  tasks,
  stamped,
  requestStatus,
}: {
  statuses: TaskApprovalStatus[];
  tasks: Task[];
  stamped?: JustStamped;
  requestStatus: RequestStatus;
}) {
  return (
    <ul className="flex flex-col gap-4">
      {statuses.map((status) => {
        const task = tasks.find((t) => t.id === status.taskId);
        return (
          <li key={status.taskId}>
            {statuses.length > 1 && (
              <p
                className="mb-1.5 truncate text-sm font-medium text-ink"
                title={task?.title}
              >
                {task?.title}
              </p>
            )}
            <div className="overflow-x-auto">
              <ApprovalStamps
                status={status}
                requestStatus={requestStatus}
                justStampedBy={
                  stamped?.taskIds.includes(status.taskId)
                    ? stamped.userId
                    : undefined
                }
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ApprovalDetail({
  requestId,
  nextRequestId,
  otherCount = 0,
  progressDefaultOpen = false,
}: {
  requestId: string;
  nextRequestId?: string;
  /** 이 요청 말고 큐에 남은 요청 수 */
  otherCount?: number;
  /** 진행 상황을 펼친 채로 보여 준다 (변조 시연) */
  progressDefaultOpen?: boolean;
}) {
  const me = useMe();
  const refreshAll = useRefreshAll();
  const requestQuery = useRequest(requestId);
  const request = requestQuery.data;
  const approvalStatuses = useApprovalStatuses(request);
  const externalHint = useIsExternal();

  // 다른 사람의 승인이나 Plan 변경으로 요청이 바뀌면 승인 자료도 다시 받는다.
  const contextQuery = useQuery({
    queryKey: [
      "approval-context",
      requestId,
      request?.currentPlanId ?? null,
      request?.updatedAt ?? null,
    ],
    queryFn: () => approvalsApi.context(requestId),
    enabled: Boolean(request),
    placeholderData: keepPreviousData,
  });
  const keysQuery = useQuery({
    queryKey: ["me", "signing-keys"],
    queryFn: async () => (await meApi.signingKeys()).items,
  });

  const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set());
  const [step, setStep] = useState<SignStep | null>(null);
  const [runState, setRunState] = useState<SignRunState | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    response: SubmitApprovalResponse;
    doc: boolean;
  } | null>(null);
  const [stamped, setStamped] = useState<JustStamped | undefined>();
  const [decision, setDecision] = useState<DecisionKind | null>(null);

  // 다시 받기에 실패하면 이전 자료를 믿지 않는다. 옛 Plan에 무결성 ✅와 활성 버튼이 남으면 안 된다.
  const context = contextQuery.isError ? undefined : contextQuery.data;
  const integrity = useMemo(
    () =>
      context ? verifyIntegrity(context, me.id, requestQuery.data?.projectId) : null,
    [context, me.id, requestQuery.data?.projectId],
  );

  // 서명 대상은 승인 자료의 Plan이고, 진행 상태만 요청 상세에서 최신 값을 가져온다.
  const tasks = useMemo<Task[]>(() => {
    const plan = context?.plan ?? request?.currentPlan;
    if (!plan) return [];
    if (request?.currentPlan?.id !== plan.id) return plan.tasks;
    return plan.tasks.map((task) => ({
      ...task,
      status:
        request.currentPlan?.tasks.find((t) => t.id === task.id)?.status ??
        task.status,
    }));
  }, [context, request]);

  // 승인 자료의 network는 서버가 이 요청을 보고 판별한 값이라 응답 헤더로 받은 값보다 앞선다.
  const external = context ? context.network === "EXTERNAL" : externalHint;
  // 서버는 내가 이미 서명한 작업도 승인 대기면 approvable로 준다. 같은 서명을 또 만들지 않도록 뺀다.
  // 해시 대상에 없는 작업(금지 작업)은 서명할 수 없으니 고를 수도 없게 한다.
  const signable = new Set(context?.hashTarget.tasks.map((task) => task.id));
  const signedByMe = (taskId: string) =>
    Boolean(
      request?.approvals.some(
        (approval) =>
          approval.approverId === me.id &&
          approval.planId === context?.plan.id &&
          approval.taskIds.includes(taskId),
      ),
    );
  const approvable = (context?.approvableTaskIds ?? []).filter(
    (id) => signable.has(id) && !signedByMe(id),
  );
  const blocked = context?.blockedTaskIds ?? [];
  const selected = approvable.filter((id) => !deselected.has(id));
  // 외부망에서 막힌 문서 작업도 버튼 문구는 적용/미적용이어야 해서, 고를 게 없으면 막힌 작업을 기준으로 삼는다.
  const decisionBase = (
    selected.length > 0
      ? selected
      : approvable.length > 0
        ? approvable
        : blocked
  )
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is Task => Boolean(t));
  // 문서 작업이면 적용 = 승인, 미적용 = 거부 (기능 명세서 5.4)
  const docMode =
    decisionBase.length > 0 && decisionBase.every((t) => t.type === "DOC");

  // 서명은 이 기기의 키로 한다. 다른 기기에 등록된 키가 있어도 이 기기의 키가 등록되어 있어야 한다.
  const deviceKeyId = deviceStore.get(me.id).keyId;
  const deviceKey = keysQuery.data?.find((key) => key.id === deviceKeyId);
  const keyChecking = keysQuery.isPending;
  const keyReady =
    signingService.hasDeviceKey(me.id) &&
    deviceKey?.status === "REGISTERED" &&
    !integrity?.keyMissing;

  const sign = useMutation({
    meta: { silent: true },
    mutationFn: async (taskIds: string[]) => {
      if (!context) throw new Error("승인 자료를 불러오지 못했습니다");
      return signAndSubmitApproval({
        me,
        context,
        taskIds,
        shownProjectId: requestQuery.data?.projectId,
        onStep: async (next) => {
          setStep(next);
          await delay(STEP_DELAY_MS);
        },
      });
    },
    onMutate: () => {
      setStep(null);
      setRunState("running");
      setSignError(null);
      setResult(null);
      setStamped(undefined);
    },
    onSuccess: async (response, taskIds) => {
      // 결재란의 도장은 새 요청 상태와 함께 처음 그려질 때 한 번 찍힌다. 그래서 다시 받기 전에 정해 둔다.
      setStamped({ userId: me.id, taskIds });
      // 요청 상태를 먼저 새로 받아 결과와 상태가 어긋나 보이지 않게 한다.
      await refreshAll();
      setRunState("done");
      setResult({ response, doc: docMode });
    },
    onError: async (error) => {
      setRunState("failed");
      setSignError(errorMessage(error));
      // PLAN_HASH_MISMATCH 등: 최신 Plan을 다시 받아 확인하게 한다.
      await refreshAll();
    },
  });

  const decide = useMutation({
    mutationFn: ({ reason, kind }: { reason: string; kind: DecisionKind }) =>
      approvalsApi.reject(requestId, {
        planId: context?.plan.id as string,
        taskIds: selected,
        // TODO(spec): 기능 명세서 DEP-03에 "수정 요청"이 있지만 API가 없다. 거부 API에 표시를 붙여 사유로 전달한다.
        reason: kind === "change" ? `[수정 요청] ${reason}` : reason,
      }),
    onSuccess: async (_data, { kind }) => {
      setDecision(null);
      toast.success(
        kind === "change"
          ? "수정 요청을 보냈습니다"
          : docMode
            ? "미적용으로 처리했습니다"
            : "거부했습니다",
      );
      await refreshAll();
    },
    onError: async () => {
      setDecision(null);
      await refreshAll();
    },
  });

  if (requestQuery.isPending) {
    return (
      <div className="min-w-0 flex-1">
        <Spinner />
      </div>
    );
  }
  // 볼 수 없는 요청이다. 서버는 403을 준다. 승인 후보에 이름이 없는 "누구나 승인" 작업도 서버가 상세를 막아 여기로 온다.
  if (
    requestQuery.error instanceof ApiError &&
    (requestQuery.error.code === "NOT_FOUND" ||
      requestQuery.error.code === "FORBIDDEN_ROLE")
  ) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center bg-paper">
        <EmptyState
          title="이 요청은 지금 볼 수 없습니다"
          action={
            nextRequestId && (
              <Link
                to={`/approvals/${nextRequestId}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-seal hover:underline"
              >
                다음 승인 대기 열기
                <ArrowRight size={14} aria-hidden />
              </Link>
            )
          }
        >
          요청자가 Plan을 고치는 중이거나 조회 권한이 없는 요청입니다. 조회할 수
          없으면 서명할 내용도 확인할 수 없어 서명하지 않습니다.
        </EmptyState>
      </div>
    );
  }
  if (requestQuery.isError || !request) {
    return (
      <div className="min-w-0 flex-1">
        <ErrorState
          error={requestQuery.error}
          onRetry={() => requestQuery.refetch()}
        />
      </div>
    );
  }

  const contextError = contextQuery.error;
  // 서버는 아직 Plan이 없을 때만 승인 자료를 INVALID_STATE로 막는다.
  const expectedContextError =
    contextError instanceof ApiError && contextError.code === "INVALID_STATE";

  const toggle = (taskId: string) => {
    setDeselected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  // 서버가 거부하더라도, 지금 받는 Plan이 아니면 화면에서 먼저 막는다.
  const samePlan =
    Boolean(context) && request.currentPlanId === context?.plan.id;
  const accepting =
    request.status === "PENDING_APPROVAL" &&
    samePlan &&
    !contextQuery.isPlaceholderData;

  // 키를 아직 안 만든 사람은 고정한 웹쉘 공개키도 없어 서명할 수 없다. 변조가 아니라 키 등록이 먼저다.
  const onlyAwaitingKey = Boolean(
    integrity?.keyMissing &&
    integrity.hashOk &&
    integrity.displayOk &&
    !keysQuery.isError &&
    !keyReady,
  );
  const integrityFailed = Boolean(
    integrity && !integrity.ok && !onlyAwaitingKey,
  );

  let signBlockedReason: string | null = null;
  if (integrityFailed)
    signBlockedReason = "Plan 무결성 확인에 실패해 서명할 수 없습니다.";
  // 서버의 승인·거부 API는 내부망 전용이다 (ApprovalController).
  else if (external)
    signBlockedReason = "승인과 거부는 내부망에서만 할 수 있습니다.";
  else if (keyChecking) signBlockedReason = "승인 키를 확인하고 있습니다.";
  else if (keysQuery.isError)
    signBlockedReason =
      "승인 키 상태를 확인하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.";
  else if (!keyReady)
    signBlockedReason = "승인 키를 등록해야 서명할 수 있습니다.";
  else if (request.status !== "PENDING_APPROVAL")
    signBlockedReason = "지금은 승인을 받지 않는 상태입니다.";
  else if (!samePlan)
    signBlockedReason = "Plan이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.";
  else if (contextQuery.isPlaceholderData)
    signBlockedReason = "최신 승인 자료를 확인하고 있습니다.";
  else if (approvable.length === 0)
    signBlockedReason = "지금 내가 승인할 수 있는 작업이 없습니다.";
  else if (selected.length === 0) signBlockedReason = "승인할 작업을 고르세요.";

  const approveLabel = docMode ? "적용" : "승인(서명)";
  const rejectLabel = docMode ? "미적용" : "거부";
  // 저장소와 기준 커밋은 해시로 확인하는 hashTarget의 값을 보여 준다.
  const plan =
    request.currentPlan && context
      ? {
          ...request.currentPlan,
          repository: context.hashTarget.repository,
          baseCommit: context.hashTarget.baseCommit,
        }
      : request.currentPlan;
  const nothingLeft = result?.response.remainingTaskIds.length === 0;
  // 제출 결과는 그 순간의 값이다. 웹쉘 연결이 돌아와 다시 시도된 결과는 요청 상태로 따라간다.
  // 실패한 뒤 상태가 바뀌었으면(다시 제출, 취소 등) 지난 실패 결과는 치운다.
  const staleFailure =
    result?.response.status === "VERIFICATION_FAILED" &&
    request.status !== "VERIFICATION_FAILED";
  const verificationFailed =
    Boolean(result) &&
    !staleFailure &&
    (result?.response.status === "VERIFICATION_FAILED" ||
      request.status === "VERIFICATION_FAILED");
  const executionRequested =
    result?.response.executionRequested ||
    (nothingLeft && EXECUTION_STARTED.includes(request.status));
  // 서명을 마쳐 더 고를 작업이 없으면 결정 버튼을 치운다. 남은 작업이 있으면 이어서 서명한다.
  // 이미 내 승인을 마친 요청을 다시 열었을 때도 같은 상태로 본다.
  const nothingToDecide =
    Boolean(context) &&
    !contextQuery.isPlaceholderData &&
    request.status === "PENDING_APPROVAL" &&
    approvable.length === 0 &&
    blocked.length === 0 &&
    !integrityFailed;
  // 서버는 승인권자가 아니어도 승인 자료를 준다. 내 서명 기록이 있어야 "내 승인은 끝났습니다"라고 말한다.
  const hasMySignature = request.approvals.some(
    (approval) =>
      approval.approverId === me.id && approval.planId === context?.plan.id,
  );
  const alreadyMine = nothingToDecide && hasMySignature;
  const notApprover = nothingToDecide && !hasMySignature;
  const decisionDone =
    (Boolean(result) || alreadyMine) && approvable.length === 0;
  // 작업을 고를 수 있거나 일부가 막혀 있을 때만 몇 개에 서명하는지 알려 준다.
  const showSelectedCount =
    selected.length > 0 && approvable.length + blocked.length > 1;
  const canDecide =
    selected.length > 0 && !sign.isPending && accepting && !external;

  // 안내는 한 번에 하나만, 가장 중요한 것을 보여 준다.
  let notice: ReactNode = null;
  if (integrityFailed) {
    notice = (
      <Banner
        tone="danger"
        title="이 Plan은 실제로 서명할 내용과 다를 수 있습니다"
      >
        AI 설명은 검증되지 않은 참고 자료입니다. 실제 변경 내용을 확인하고,
        서명하지 말고 관리자에게 알려 주세요.
      </Banner>
    );
  } else if (expectedContextError) {
    notice = <NoPlanNotice requestId={requestId} />;
  } else if (contextQuery.isError) {
    notice = (
      <ErrorState error={contextError} onRetry={() => contextQuery.refetch()} />
    );
  } else if (notApprover && !result) {
    notice = (
      <Banner
        tone="warning"
        title="이 작업의 승인권자가 아닙니다"
        action={
          <Link to={`/requests/${requestId}`} className="font-medium underline">
            요청 상세 보기
          </Link>
        }
      >
        승인 현황과 실행 로그는 요청 상세에서 볼 수 있습니다.
      </Banner>
    );
  } else if (context && request.status !== "PENDING_APPROVAL" && !result) {
    notice = (
      <Banner
        tone="neutral"
        title={`이 요청은 지금 ${REQUEST_STATUS_LABEL[request.status]} 상태라 승인을 받지 않습니다`}
      />
    );
  } else if (external && context && approvable.length + blocked.length > 0) {
    // 키가 없어도 내부망이 먼저다. 키를 만들어도 외부망에서는 제출할 수 없다.
    notice = (
      <Banner
        tone="warning"
        title="외부망에서는 승인하거나 거부할 수 없습니다"
      >
        내용은 여기서 확인할 수 있습니다. 승인 서명과 거부는 내부망에서 접속해
        주세요.
      </Banner>
    );
  } else if (context && keysQuery.isSuccess && !keyReady) {
    notice = (
      <Banner
        tone="warning"
        title="승인 키 등록 필요"
        action={
          <Link to="/me" className="font-medium underline">
            내 정보로 이동
          </Link>
        }
      >
        {deviceKey?.status === "PENDING"
          ? "승인 키가 관리자 등록을 기다리고 있습니다."
          : me.hasRegisteredSigningKey
            ? "이 기기에 등록된 승인 키가 없습니다. 키를 만든 기기에서 서명하거나 이 기기에서 새로 등록해 주세요."
            : "이 기기에서 승인 키를 만들고 관리자 등록을 받으면 서명할 수 있습니다."}
      </Banner>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row">
      {/* 가운데: 무엇이 바뀌는지 */}
      <div className="quiet-scroll min-h-0 min-w-0 flex-1 overflow-y-auto bg-paper">
        <div className="mx-auto flex max-w-[65rem] flex-col gap-5 px-4 py-5 xl:px-7 xl:py-7">
          <header>
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-[1.625rem] leading-snug font-semibold tracking-[-0.02em] whitespace-pre-wrap">
                {request.prompt}
              </h2>
              <Link
                to={`/requests/${requestId}`}
                className="shrink-0 pt-1.5 text-sm text-ink-3 hover:text-seal hover:underline"
              >
                요청 상세 보기
              </Link>
            </div>
            <RequestMeta
              request={request}
              plan={plan}
              planHash={context?.planHash}
              taskCount={tasks.length}
            />
          </header>

          {notice}

          <ProgressSection
            requestId={requestId}
            defaultOpen={progressDefaultOpen}
          />

          {tasks.length > 0 && (
            <TaskRows>
              {tasks.map((task) => {
                const canApprove = approvable.includes(task.id);
                const isBlocked = blocked.includes(task.id);
                return (
                  <TaskCard
                    key={task.id}
                    task={task}
                    number={taskNumber(task, tasks)}
                    requestId={requestId}
                    requestStatus={request.status}
                    planKind={context?.plan.kind ?? request.currentPlan?.kind}
                    defaultOpen={task.risk === "HIGH" || task.type === "DOC" || integrityFailed}
                    highlighted={request.changedTaskIds?.includes(task.id)}
                    leading={
                      !context ? undefined : task.risk !== "FORBIDDEN" &&
                        task.status === "PENDING" &&
                        !isRequestEnded(request.status) ? (
                        <input
                          type="checkbox"
                          className="size-4 accent-seal disabled:cursor-not-allowed"
                          aria-label={`${task.title} 승인 대상으로 선택`}
                          checked={canApprove && !deselected.has(task.id)}
                          disabled={!canApprove}
                          title={
                            isBlocked
                              ? "내부망 승인 필요"
                              : canApprove
                                ? undefined
                                : "지금 내가 승인할 수 없는 작업입니다"
                          }
                          onChange={() => toggle(task.id)}
                        />
                      ) : (
                        // 체크할 수 없는 카드도 제목 줄을 맞춘다. 진행 상태는 카드의 상태 배지가 보여 준다.
                        <span className="block size-4" aria-hidden />
                      )
                    }
                    footer={
                      task.risk === "FORBIDDEN" || isRequestEnded(request.status)
                        ? undefined
                        : taskNote(
                            task,
                            canApprove,
                            isBlocked,
                            approvalStatuses.find(
                              (s) => s.taskId === task.id,
                            ),
                          )
                    }
                  />
                );
              })}
            </TaskRows>
          )}

          <div className="flex flex-col gap-6 xl:hidden">
            {integrity && context && (
              <IntegrityCheck
                result={integrity}
                receivedHash={context.planHash}
                awaitingKey={onlyAwaitingKey}
              />
            )}
            {approvalStatuses.length > 0 && (
              <section>
                <h2 className="mb-3 text-base font-semibold">결재란</h2>
                <StampSheet
                  statuses={approvalStatuses}
                  tasks={tasks}
                  stamped={stamped}
                  requestStatus={request.status}
                />
              </section>
            )}
          </div>
        </div>
      </div>

      {/* 오른쪽: 확인하고 결정한다 */}
      <aside
        aria-label="승인 결정"
        className="flex w-full shrink-0 flex-col border-t border-rule bg-sheet xl:w-[18rem] xl:border-l xl:border-t-0"
      >
        <div className="quiet-scroll hidden min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 xl:flex xl:p-5">
          {integrity && context && (
            <IntegrityCheck
              result={integrity}
              receivedHash={context.planHash}
              awaitingKey={onlyAwaitingKey}
            />
          )}
          {approvalStatuses.length > 0 && (
            <section>
              <h2 className="mb-3 text-base font-semibold">결재란</h2>
              <StampSheet
                statuses={approvalStatuses}
                tasks={tasks}
                stamped={stamped}
                requestStatus={request.status}
              />
            </section>
          )}
        </div>

        {context && integrity && (
          <div className="flex shrink-0 flex-col gap-3 border-t border-rule p-4 xl:p-5">
            {runState && runState !== "done" && (
              <SignProgress step={step} state={runState} />
            )}
            {signError && (
              <Banner tone="danger" title="서명을 제출하지 못했습니다">
                {signError}
              </Banner>
            )}
            {verificationFailed && (
              <Banner
                tone="danger"
                title="웹쉘이 승인 서명 검증에 실패했습니다"
              >
                실행하지 않았습니다.{" "}
                <Link
                  to={`/requests/${requestId}`}
                  className="font-medium underline"
                >
                  실패 항목 보기
                </Link>
              </Banner>
            )}
            {result && !staleFailure && !verificationFailed && (
              <div className="flex items-center gap-3.5">
                <ResultSeal label={result.doc ? "적용" : "승인"} />
                <div className="min-w-0 text-sm break-keep text-ink-2">
                  {executionRequested ? (
                    <>
                      <p className="text-base font-semibold text-ink">
                        필요한 승인이 모두 모여 실행을 요청했습니다
                      </p>
                      <Link
                        to={`/requests/${requestId}`}
                        className="font-medium underline"
                      >
                        실행 로그 보기
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className="text-base font-semibold text-ink">
                        {result.doc
                          ? "적용으로 처리했습니다"
                          : "승인 서명을 제출했습니다"}
                      </p>
                      {request.status === "PENDING_APPROVAL" && (
                        <p>
                          {nothingLeft
                            ? `${executionDeferredText()}.`
                            : "다른 작업의 승인이 모이면 실행을 요청합니다."}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            {alreadyMine && !result && (
              <p className="text-base font-semibold text-ink">
                내 승인은 끝났습니다
              </p>
            )}
            {nextRequestId && decisionDone && (
              <Link
                to={`/approvals/${nextRequestId}`}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-rule-strong px-4 text-base font-medium text-ink hover:bg-sheet-alt"
              >
                다음 승인 대기 열기
                {otherCount > 0 && (
                  <span className="text-sm font-normal text-ink-3">
                    남은 {otherCount}건
                  </span>
                )}
                <ArrowRight size={16} aria-hidden />
              </Link>
            )}

            {!decisionDone && (
              <>
                {signBlockedReason && !result && (
                  <p className="text-sm text-ink-2">{signBlockedReason}</p>
                )}
                {showSelectedCount && (
                  <p className="text-base font-semibold text-ink">
                    선택한 작업 {selected.length}개
                  </p>
                )}
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  disabled={Boolean(signBlockedReason)}
                  loading={sign.isPending}
                  onClick={() => sign.mutate(selected)}
                >
                  {approveLabel}
                </Button>
                <div className="flex justify-center gap-1">
                  <Button
                    variant="ghost"
                    size="md"
                    disabled={!canDecide}
                    onClick={() => setDecision("reject")}
                  >
                    {rejectLabel}
                  </Button>
                  {USE_MOCK ? (
                    <Button
                      variant="ghost"
                      size="md"
                      disabled={!canDecide}
                      onClick={() => setDecision("change")}
                    >
                      수정 요청
                    </Button>
                  ) : (
                    canDecide && approvable.length > 0 && (
                      <p role="status" className="self-center text-xs text-ink-3">
                        현재 서버는 수정 요청을 지원하지 않습니다.
                      </p>
                    )
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </aside>

      <ReasonModal
        open={USE_MOCK && decision === "reject" && canDecide}
        title={docMode ? "문서를 적용하지 않습니다" : "작업을 거부합니다"}
        description="선택한 작업을 거부하면 요청 전체가 거부 상태가 되고 요청자에게 알립니다."
        label="사유"
        placeholder="거부하는 이유를 적어 주세요"
        confirmLabel={rejectLabel}
        loading={decide.isPending}
        onConfirm={(reason) => decide.mutate({ reason, kind: "reject" })}
        onClose={() => setDecision(null)}
      />
      <ConfirmModal
        open={!USE_MOCK && decision === "reject" && canDecide}
        title={docMode ? "문서를 미적용 처리할까요?" : "요청을 거부할까요?"}
        confirmLabel={rejectLabel}
        danger
        loading={decide.isPending}
        onConfirm={() => decide.mutate({ reason: "", kind: "reject" })}
        onClose={() => setDecision(null)}
      >
        선택한 작업과 요청 전체가 거부 상태로 바뀝니다. 현재 서버는 거부 사유를 저장하지 않습니다.
      </ConfirmModal>
      <ReasonModal
        open={USE_MOCK && decision === "change" && canDecide}
        title="수정을 요청합니다"
        description="요청은 거부 상태가 되고, 적은 내용이 요청자에게 전달됩니다."
        label="수정할 내용"
        placeholder="어떻게 고치면 되는지 적어 주세요"
        confirmLabel="수정 요청"
        danger={false}
        loading={decide.isPending}
        onConfirm={(reason) => decide.mutate({ reason, kind: "change" })}
        onClose={() => setDecision(null)}
      />
    </div>
  );
}
