import { useMutation, useQuery } from '@tanstack/react-query'
import { FileText, History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { documentsApi, requestsApi } from '../../api/endpoints'
import { ApiError, errorMessage } from '../../api/errors'
import type { DocumentSummary, DocumentVersionSummary, RequestStatus } from '../../api/types'
import { DiffViewer } from '../../components/DiffViewer'
import { Timeline, UserChip } from '../../components/rich'
import { toast } from '../../components/toast'
import {
  Banner,
  Button,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Mono,
  PageHeader,
  Select,
  Sheet,
  Spinner,
  Tabs,
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

type ViewTab = 'body' | 'diff'

function VersionView({ document, version }: { document: DocumentSummary; version: number }) {
  const [tab, setTab] = useState<ViewTab>('body')
  const current = useQuery({
    queryKey: ['document-version', document.id, version],
    queryFn: () => documentsApi.version(document.id, version),
  })
  const hasPrevious = version > 1
  const previous = useQuery({
    queryKey: ['document-version', document.id, version - 1],
    queryFn: () => documentsApi.version(document.id, version - 1),
    enabled: hasPrevious && tab === 'diff',
  })
  const diff = useMemo(
    () => (previous.data && current.data ? makeUnifiedDiff(document.path, previous.data.body, current.data.body) : null),
    [previous.data, current.data, document.path],
  )
  const stats = useMemo(() => (diff ? diffStats(diff) : null), [diff])

  if (current.isPending) return <Spinner />
  if (current.isError) return <ErrorState error={current.error} onRetry={() => current.refetch()} />

  return (
    <>
      <Tabs<ViewTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'body', label: '본문' },
          { id: 'diff', label: '이전 버전과 비교' },
        ]}
      />
      <div className="quiet-scroll h-[calc(100dvh-25rem)] min-h-64 overflow-y-auto">
        {tab === 'body' ? (
          <MarkdownText body={current.data.body} />
        ) : !hasPrevious ? (
          <EmptyState title="첫 버전입니다">비교할 이전 버전이 없습니다.</EmptyState>
        ) : previous.isPending ? (
          <Spinner />
        ) : previous.isError ? (
          <ErrorState error={previous.error} onRetry={() => previous.refetch()} />
        ) : (
          <>
            {stats && (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-ink-3 tabular-nums">
                v{version - 1}에서 v{version}으로
                <span className="font-medium text-low">+{stats.added}</span>
                <span className="font-medium text-high">−{stats.removed}</span>
              </p>
            )}
            {diff && <DiffViewer diff={diff} />}
          </>
        )}
      </div>
    </>
  )
}

function VersionTimeline({
  document,
  items,
  selected,
  onSelect,
}: {
  document: DocumentSummary
  items: DocumentVersionSummary[]
  selected: number
  onSelect: (version: number) => void
}) {
  return (
    <Timeline
      items={items.map((item) => {
        const isSelected = item.version === selected
        return {
          key: String(item.version),
          tone: item.version === document.currentVersion ? 'current' : 'done',
          title: (
            <span className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(item.version)}
                className={`rounded px-1 font-semibold hover:underline ${
                  isSelected ? 'bg-seal-soft text-seal-dark' : 'text-seal'
                }`}
              >
                v{item.version}
              </button>
              {item.version === document.currentVersion && (
                <span className="rounded bg-low-soft px-1.5 text-xs font-medium text-low">현재 적용</span>
              )}
            </span>
          ),
          meta: (
            <span className="mt-1 flex flex-col gap-1">
              <UserChip name={item.createdBy.name} sub={formatDateTime(item.createdAt)} />
              {item.requestId ? (
                <Link to={`/requests/${item.requestId}`} className="font-mono text-seal hover:underline">
                  {item.requestId}
                </Link>
              ) : (
                <span>요청 없이 등록</span>
              )}
            </span>
          ),
        }
      })}
    />
  )
}

function DocumentDetail({ document }: { document: DocumentSummary }) {
  const navigate = useNavigate()
  const refreshAll = useRefreshAll()
  const [searchParams, setSearchParams] = useSearchParams()
  const [confirming, setConfirming] = useState(false)
  const [rollbackRefused, setRollbackRefused] = useState(false)

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

  if (versions.isPending) return <div className="col-span-2"><Spinner /></div>
  if (versions.isError) {
    return (
      <div className="col-span-2">
        <ErrorState error={versions.error} onRetry={() => versions.refetch()} />
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <Sheet className="col-span-2">
        <EmptyState title="저장된 버전이 없습니다">문서 작업을 적용하면 버전이 쌓입니다.</EmptyState>
      </Sheet>
    )
  }

  const selectedItem = items.find((item) => item.version === selected)
  const rollbackBlockedReason = isCurrent
    ? '지금 적용된 버전입니다. 되돌릴 이전 버전을 고르세요'
    : !appliedBy
      ? '이 문서를 적용한 요청이 없어 되돌릴 수 없습니다'
      : statusBlocks
        ? `이 문서를 마지막으로 적용한 요청이 ${REQUEST_STATUS_LABEL[requestStatus]} 상태라 롤백할 수 없습니다`
        : null
  const showBlockedNotice = !isCurrent && Boolean(appliedBy) && (statusBlocks || rollbackRefused)
  const stillRunning = requestStatus !== undefined && IN_PROGRESS.includes(requestStatus)

  return (
    <>
      <Sheet
        title={
          <>
            {document.title} <span className="font-normal text-ink-3">v{selected}</span>
            {!isCurrent && (
              <span className="rounded bg-medium-soft px-1.5 text-xs font-medium text-medium">과거 버전</span>
            )}
          </>
        }
        icon={<FileText size={16} aria-hidden />}
        actions={
          <span className="flex items-center gap-3 text-xs text-ink-3">
            <Mono className="text-ink-2">{document.path}</Mono>
            {selectedItem && (
              <span>
                {selectedItem.createdBy.name}, {formatDateTime(selectedItem.createdAt)}
              </span>
            )}
          </span>
        }
      >
        <VersionView key={selected} document={document} version={selected} />
      </Sheet>

      <div className="sticky top-4 flex flex-col gap-4">
        <Sheet title="버전 기록" icon={<History size={16} aria-hidden />}>
          <div className="quiet-scroll max-h-[calc(100dvh-30rem)] min-h-32 overflow-y-auto pr-1">
            <VersionTimeline
              document={document}
              items={items}
              selected={selected}
              onSelect={(version) => setSearchParams({ v: String(version) }, { replace: true })}
            />
          </div>
        </Sheet>

        <Sheet title={`v${selected}으로 되돌리기`}>
          <div className="flex flex-col gap-3">
            {showBlockedNotice ? (
              <Banner tone="warning" title="지금은 이 문서를 롤백할 수 없습니다">
                이 문서를 마지막으로 적용한{' '}
                <Link to={`/requests/${appliedBy}`} className="underline">
                  요청
                </Link>
                {stillRunning ? (
                  <>
                    이 {requestStatus && REQUEST_STATUS_LABEL[requestStatus]} 상태입니다. 그 요청이 끝난 뒤 다시 시도해 주세요.
                  </>
                ) : (
                  <>
                    이 이미 롤백을 마쳤거나 진행 중입니다. 이전 내용으로 되돌리려면 작업 요청에서 문서 수정을 새 요청으로
                    만들어 주세요.
                  </>
                )}
              </Banner>
            ) : (
              <p className="text-[0.8125rem] text-ink-2">
                {rollbackBlockedReason ?? '바로 되돌리지 않습니다. 롤백 Plan도 같은 승인 절차를 거친 뒤 새 버전으로 저장됩니다.'}
              </p>
            )}
            <div className="[&>span]:flex [&>span]:w-full">
              <Button
                variant="secondary"
                className="w-full"
                internalOnly
                disabled={Boolean(rollbackBlockedReason)}
                disabledReason={rollbackBlockedReason}
                onClick={() => setConfirming(true)}
              >
                이 버전으로 롤백
              </Button>
            </div>
          </div>
        </Sheet>
      </div>

      <ConfirmModal
        open={confirming}
        title={`v${selected}으로 롤백할까요?`}
        confirmLabel="롤백 Plan 만들기"
        loading={rollback.isPending}
        onConfirm={() => rollback.mutate()}
        onClose={() => setConfirming(false)}
      >
        <p>
          바로 되돌리지 않습니다. 롤백 Plan도 같은 승인 절차(해시 확인, 서명, 실행기 검증)를 거친 뒤 실행되며, 실행되면 새
          버전으로 저장됩니다.
        </p>
        <p className="mt-2">코드·DB·배포 작업은 롤백 기능이 없고, 문서만 되돌릴 수 있습니다.</p>
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

  return (
    <>
      <PageHeader
        title="문서"
        description="적용할 때마다 버전이 저장되고, 이전 버전으로 되돌릴 수 있습니다."
        actions={
          <div className="w-56">
            <Select
              aria-label="프로젝트"
              value={projectId}
              onChange={(event) => {
                setChosenProjectId(event.target.value)
                navigate('/documents')
              }}
            >
              {projects.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {pendingDocs.length > 0 && (
        <div className="mb-4">
          <Banner tone="info" title={`적용을 기다리는 문서 작업이 ${pendingDocs.length}건 있습니다`}>
            <ul className="mt-0.5 flex flex-wrap gap-x-4">
              {pendingDocs.map((item) => (
                <li key={`${item.requestId}-${item.taskId}`}>
                  <Link to={`/approvals/${item.requestId}`} className="underline">
                    {item.taskTitle}
                  </Link>
                </li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
      ) : documents.isError ? (
        <ErrorState error={documents.error} onRetry={() => documents.refetch()} />
      ) : projects.isPending || documents.isPending ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-[14rem_minmax(0,1fr)_18rem] items-start gap-4 2xl:grid-cols-[17rem_minmax(0,1fr)_21rem]">
          <Sheet title="문서 목록" flush className="sticky top-4">
            {listed.length === 0 ? (
              <EmptyState title="문서가 없습니다">문서 작업을 적용하면 여기에 나타납니다.</EmptyState>
            ) : (
              <ul className="quiet-scroll max-h-[calc(100dvh-17rem)] overflow-y-auto">
                {listed.map((document) => {
                  const active = document.id === documentId
                  return (
                    <li key={document.id} className="border-b border-rule last:border-b-0">
                      <Link
                        to={`/documents/${document.id}`}
                        aria-current={active ? 'page' : undefined}
                        className={`block px-4 py-2.5 hover:bg-paper ${
                          active ? 'bg-seal-soft shadow-[inset_3px_0_0_var(--color-seal)]' : ''
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className={`truncate text-sm font-medium ${active ? 'text-seal-dark' : 'text-ink'}`}>
                            {document.title}
                          </span>
                          <span className="shrink-0 rounded bg-paper px-1.5 text-xs text-ink-2 tabular-nums">
                            v{document.currentVersion}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-xs text-ink-3">{document.path}</span>
                        <span className="block text-xs text-ink-3">{formatDateTime(document.updatedAt)}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Sheet>

          {selected ? (
            <DocumentDetail key={selected.id} document={selected} />
          ) : (
            <Sheet className="col-span-2">
              <EmptyState title={documentId ? '문서를 찾을 수 없습니다' : '문서를 고르세요'}>
                왼쪽 목록에서 문서를 고르면 버전과 본문을 볼 수 있습니다.
              </EmptyState>
            </Sheet>
          )}
        </div>
      )}
    </>
  )
}
