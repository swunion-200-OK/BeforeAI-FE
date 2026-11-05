import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { documentsApi, requestsApi } from '../../api/endpoints'
import { ApiError, errorMessage } from '../../api/errors'
import type { DocumentSummary, DocumentVersionSummary, RequestStatus } from '../../api/types'
import { DiffViewer } from '../../components/DiffViewer'
import { toast } from '../../components/toast'
import {
  Banner,
  Button,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Mono,
  Select,
  Sheet,
  Spinner,
  Tooltip,
} from '../../components/ui'
import { makeUnifiedDiff } from '../../lib/diff'
import { diffStats } from '../../lib/explain'
import { formatDateTime } from '../../lib/format'
import { REQUEST_STATUS_LABEL } from '../../lib/labels'
import { usePendingApprovals, useProjects, useRefreshAll, useRequest } from '../../lib/queries'
import { MarkdownText } from './MarkdownText'

/** 문서 롤백을 걸 수 있는 요청 상태 (API 명세 6장) */
const ROLLBACK_ALLOWED: RequestStatus[] = ['COMPLETED', 'PARTIALLY_COMPLETED', 'KILLED', 'ROLLBACK_FAILED']
/** 아직 진행 중이라 끝나면 다시 시도할 수 있는 상태 */
const IN_PROGRESS: RequestStatus[] = [
  'ANALYZING',
  'REVIEWING',
  'PENDING_APPROVAL',
  'REAPPROVAL_REQUIRED',
  'VERIFICATION_FAILED',
  'RUNNING',
  'ROLLING_BACK',
]

/** 고른 버전의 본문, 또는 바로 앞 버전과의 비교 */
function VersionView({
  document,
  version,
  comparing,
}: {
  document: DocumentSummary
  version: number
  comparing: boolean
}) {
  const current = useQuery({
    queryKey: ['document-version', document.id, version],
    queryFn: () => documentsApi.version(document.id, version),
  })
  const previous = useQuery({
    queryKey: ['document-version', document.id, version - 1],
    queryFn: () => documentsApi.version(document.id, version - 1),
    enabled: comparing,
  })
  const diff = useMemo(
    () => (previous.data && current.data ? makeUnifiedDiff(document.path, previous.data.body, current.data.body) : null),
    [previous.data, current.data, document.path],
  )
  const stats = useMemo(() => (diff ? diffStats(diff) : null), [diff])

  if (current.isPending) return <Spinner />
  if (current.isError) return <ErrorState error={current.error} onRetry={() => current.refetch()} />
  if (!comparing) return <MarkdownText body={current.data.body} />
  if (previous.isPending) return <Spinner />
  if (previous.isError) return <ErrorState error={previous.error} onRetry={() => previous.refetch()} />
  return (
    <>
      {stats && (
        <p className="mb-2 flex items-center gap-1.5 text-[0.875rem] text-ink-3 tabular-nums">
          v{version - 1}에서 v{version}으로
          <span className="font-medium text-low">+{stats.added}</span>
          <span className="font-medium text-high">−{stats.removed}</span>
        </p>
      )}
      {diff && <DiffViewer diff={diff} />}
    </>
  )
}

function DocumentDetail({ document }: { document: DocumentSummary }) {
  const navigate = useNavigate()
  const refreshAll = useRefreshAll()
  const [searchParams, setSearchParams] = useSearchParams()
  const [confirming, setConfirming] = useState(false)
  const [rollbackRefused, setRollbackRefused] = useState(false)
  const [wantsCompare, setWantsCompare] = useState(false)

  const versions = useQuery({
    queryKey: ['document-versions', document.id],
    queryFn: async () => (await documentsApi.versions(document.id)).items,
  })

  const items: DocumentVersionSummary[] = versions.data ?? []
  const selected = Number(searchParams.get('v')) || items[0]?.version
  // 롤백은 이 문서를 마지막으로 적용한 요청에 건다 (API 명세 3.7).
  const appliedBy = items.find((item) => item.requestId)?.requestId ?? null
  const isCurrent = selected === document.currentVersion

  // 대상 요청의 상태를 미리 봐서, 눌러 보기 전에 왜 안 되는지 알려 준다. 조회 권한이 없으면 서버 판단에 맡긴다.
  const appliedRequest = useRequest(appliedBy ?? undefined)
  const requestStatus = appliedRequest.data?.status
  const statusBlocks = requestStatus !== undefined && !ROLLBACK_ALLOWED.includes(requestStatus)

  const rollback = useMutation({
    meta: { silent: true },
    mutationFn: () => requestsApi.rollback(appliedBy as string, { documentId: document.id, version: selected }),
    onError: (error) => {
      // TODO(spec): 명세 6장은 ROLLED_BACK 상태에서 다시 롤백을 허용하지 않는다.
      // 문서 버전이 요청에 묶여 있어 한 번 되돌린 문서는 새 문서 작업이 적용되기 전까지 다시 되돌릴 수 없다.
      if (error instanceof ApiError && error.code === 'INVALID_STATE') setRollbackRefused(true)
      else toast.error(errorMessage(error))
    },
    onSuccess: async ({ id }) => {
      // 화면을 옮기기 전에 확인 창을 먼저 닫는다. 그래야 토스트가 닫힌 창 안에 갇히지 않는다.
      setConfirming(false)
      await refreshAll()
      toast.success('롤백 Plan을 만들었습니다. 승인하면 문서가 되돌아갑니다')
      navigate(`/approvals/${id}`)
    },
    onSettled: () => setConfirming(false),
  })

  if (versions.isPending) return <Spinner />
  if (versions.isError) return <ErrorState error={versions.error} onRetry={() => versions.refetch()} />
  if (items.length === 0) {
    return <EmptyState title="저장된 버전이 없습니다">문서 작업을 적용하면 버전이 쌓입니다.</EmptyState>
  }

  const selectedItem = items.find((item) => item.version === selected)
  const rollbackBlockedReason = !appliedBy
    ? '이 문서를 적용한 요청이 없어 되돌릴 수 없습니다'
    : statusBlocks
      ? `이 문서를 마지막으로 적용한 요청이 ${REQUEST_STATUS_LABEL[requestStatus]} 상태라 롤백할 수 없습니다`
      : null
  const showBlockedNotice = !isCurrent && Boolean(appliedBy) && (statusBlocks || rollbackRefused)
  const stillRunning = requestStatus !== undefined && IN_PROGRESS.includes(requestStatus)
  // 첫 버전은 비교할 앞 버전이 없다.
  const canCompare = selected > 1
  const comparing = wantsCompare && canCompare

  const compareToggle = (
    <label className={`inline-flex items-center gap-2 text-sm ${canCompare ? 'text-ink-2' : 'text-ink-3'}`}>
      <input
        type="checkbox"
        checked={comparing}
        disabled={!canCompare}
        onChange={(event) => setWantsCompare(event.target.checked)}
        className="size-4 accent-seal"
      />
      이전 버전과 비교
    </label>
  )

  return (
    <>
      <h2 className="text-[1.5rem] font-bold tracking-tight">{document.title}</h2>
      <Mono className="text-ink-3">{document.path}</Mono>

      <div className="mt-4 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="w-36 shrink-0">
          <Select
            aria-label="버전"
            value={selected}
            onChange={(event) => setSearchParams({ v: event.target.value }, { replace: true })}
          >
            {items.map((item) => (
              <option key={item.version} value={item.version}>
                v{item.version}
                {item.version === document.currentVersion ? ' 현재 적용' : ''}
              </option>
            ))}
          </Select>
        </div>
        {canCompare ? compareToggle : <Tooltip text="첫 버전이라 비교할 이전 버전이 없습니다">{compareToggle}</Tooltip>}
        {selectedItem && (
          <span className="text-[0.875rem] text-ink-3">
            {selectedItem.createdBy.name}, {formatDateTime(selectedItem.createdAt)},{' '}
            {selectedItem.requestId ? (
              <>
                적용 요청{' '}
                <Link to={`/requests/${selectedItem.requestId}`} className="font-mono hover:text-seal hover:underline">
                  {selectedItem.requestId}
                </Link>
              </>
            ) : (
              '요청 없이 등록'
            )}
          </span>
        )}
        {!isCurrent && (
          <div className="ml-auto">
            <Button
              internalOnly
              disabled={Boolean(rollbackBlockedReason)}
              disabledReason={rollbackBlockedReason}
              onClick={() => setConfirming(true)}
            >
              이 버전으로 롤백
            </Button>
          </div>
        )}
      </div>

      {showBlockedNotice && (
        <p className="mb-3 text-sm text-medium">
          이 문서를 마지막으로 적용한{' '}
          <Link to={`/requests/${appliedBy}`} className="underline">
            요청
          </Link>
          {stillRunning ? (
            <>이 {requestStatus && REQUEST_STATUS_LABEL[requestStatus]} 상태입니다. 그 요청이 끝난 뒤 다시 시도해 주세요.</>
          ) : (
            <>
              이 이미 롤백을 마쳤거나 진행 중입니다. 이전 내용으로 되돌리려면 작업 요청에서 문서 수정을 새 요청으로 만들어
              주세요.
            </>
          )}
        </p>
      )}

      <Sheet flush>
        <div className="px-8 py-6">
          <VersionView key={selected} document={document} version={selected} comparing={comparing} />
        </div>
      </Sheet>

      <ConfirmModal
        open={confirming}
        title={`v${selected}으로 롤백할까요?`}
        confirmLabel="롤백 Plan 만들기"
        loading={rollback.isPending}
        onConfirm={() => rollback.mutate()}
        onClose={() => setConfirming(false)}
      >
        바로 되돌리지 않습니다. 롤백 Plan도 같은 승인 절차(해시 확인, 서명, 웹쉘 검증)를 거친 뒤 실행되며, 실행되면 새
        버전으로 저장됩니다.
      </ConfirmModal>
    </>
  )
}

export default function DocumentsPage() {
  const { documentId } = useParams()
  const navigate = useNavigate()
  const projects = useProjects()
  const pending = usePendingApprovals()
  const [chosenProjectId, setChosenProjectId] = useState<string | null>(null)

  const projectIds = useMemo(() => projects.data?.map((p) => p.id) ?? [], [projects.data])
  // TODO(spec): 문서 한 건을 ID로 읽는 API가 없어, 주소로 들어오면 전체 프로젝트의 목록에서 찾는다.
  const documents = useQuery({
    queryKey: ['documents', projectIds],
    queryFn: async () => (await Promise.all(projectIds.map((id) => documentsApi.list(id)))).flatMap((page) => page.items),
    enabled: projectIds.length > 0,
  })

  const selected = documents.data?.find((d) => d.id === documentId)
  const projectId = chosenProjectId ?? selected?.projectId ?? projectIds[0] ?? ''
  const listed = documents.data?.filter((d) => d.projectId === projectId) ?? []
  const pendingDocs = pending.data?.filter((item) => item.type === 'DOC' && item.projectId === projectId) ?? []

  // 문서를 고르지 않았으면 첫 문서를 바로 보여 준다.
  if (!documentId && listed.length > 0) return <Navigate to={`/documents/${listed[0].id}`} replace />

  if (projects.isError) return <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
  if (documents.isError) return <ErrorState error={documents.error} onRetry={() => documents.refetch()} />
  if (projects.isPending || documents.isPending) return <Spinner />

  return (
    <div className="grid grid-cols-[15rem_minmax(0,1fr)] items-start gap-8">
      <h1 className="sr-only">문서</h1>
      <nav aria-label="문서 목록" className="sticky top-6 flex flex-col gap-3">
        <Select
          aria-label="프로젝트"
          value={projectId}
          onChange={(event) => {
            setChosenProjectId(event.target.value)
            navigate('/documents')
          }}
        >
          {projects.data.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
        <ul className="flex flex-col gap-0.5">
          {listed.map((document) => {
            const active = document.id === documentId
            return (
              <li key={document.id}>
                <Link
                  to={`/documents/${document.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm ${
                    active ? 'bg-seal-soft font-medium text-seal-dark' : 'text-ink hover:bg-sheet'
                  }`}
                >
                  <span className="truncate">{document.title}</span>
                  <span className="shrink-0 text-xs font-normal text-ink-3 tabular-nums">v{document.currentVersion}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="min-w-0">
        {pendingDocs.length > 0 && (
          <div className="mb-4">
            <Banner tone="info">
              <span className="flex flex-wrap gap-x-3">
                <span>적용을 기다리는 문서 작업이 {pendingDocs.length}건 있습니다.</span>
                {pendingDocs.map((item) => (
                  <Link key={`${item.requestId}-${item.taskId}`} to={`/approvals/${item.requestId}`} className="underline">
                    {item.taskTitle}
                  </Link>
                ))}
              </span>
            </Banner>
          </div>
        )}
        {selected ? (
          <DocumentDetail key={selected.id} document={selected} />
        ) : listed.length === 0 ? (
          <EmptyState title="문서가 없습니다">문서 작업을 적용하면 여기에 나타납니다.</EmptyState>
        ) : (
          <EmptyState title={documentId ? '문서를 찾을 수 없습니다' : '문서를 고르세요'} />
        )}
      </div>
    </div>
  )
}
