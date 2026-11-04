import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { documentsApi, requestsApi } from '../../api/endpoints'
import { ApiError, errorMessage } from '../../api/errors'
import type { DocumentSummary, DocumentVersionSummary } from '../../api/types'
import { DiffViewer } from '../../components/DiffViewer'
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
import { formatDateTime } from '../../lib/format'
import { usePendingApprovals, useProjects, useRefreshAll } from '../../lib/queries'

function DocumentBody({ body }: { body: string }) {
  return (
    <pre className="max-w-[80ch] overflow-x-auto font-sans text-sm leading-relaxed whitespace-pre-wrap text-ink">
      {body}
    </pre>
  )
}

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
      {tab === 'body' ? (
        <DocumentBody body={current.data.body} />
      ) : !hasPrevious ? (
        <EmptyState title="첫 버전입니다">비교할 이전 버전이 없습니다.</EmptyState>
      ) : previous.isPending ? (
        <Spinner />
      ) : previous.isError ? (
        <ErrorState error={previous.error} onRetry={() => previous.refetch()} />
      ) : (
        <DiffViewer diff={makeUnifiedDiff(document.path, previous.data.body, current.data.body)} />
      )}
    </>
  )
}

function DocumentDetail({ document }: { document: DocumentSummary }) {
  const navigate = useNavigate()
  const refreshAll = useRefreshAll()
  const [searchParams, setSearchParams] = useSearchParams()
  const [confirming, setConfirming] = useState(false)
  const [rollbackBlocked, setRollbackBlocked] = useState(false)

  const versions = useQuery({
    queryKey: ['document-versions', document.id],
    queryFn: async () => (await documentsApi.versions(document.id)).items,
  })

  const items: DocumentVersionSummary[] = versions.data ?? []
  const selected = Number(searchParams.get('v')) || items[0]?.version
  // 롤백은 이 문서를 마지막으로 적용한 요청에 건다 (API 명세 3.7).
  const appliedBy = items.find((item) => item.requestId)?.requestId ?? null
  const isCurrent = selected === document.currentVersion

  const rollback = useMutation({
    meta: { silent: true },
    mutationFn: () => requestsApi.rollback(appliedBy as string, { documentId: document.id, version: selected }),
    onError: (error) => {
      // TODO(spec): 명세 6장은 ROLLED_BACK 상태에서 다시 롤백을 허용하지 않는다.
      // 문서 버전이 요청에 묶여 있어 한 번 되돌린 문서는 새 문서 작업이 적용되기 전까지 다시 되돌릴 수 없다.
      if (error instanceof ApiError && error.code === 'INVALID_STATE') setRollbackBlocked(true)
      else toast.error(errorMessage(error))
    },
    onSuccess: async ({ id }) => {
      await refreshAll()
      toast.success('롤백 Plan을 만들었습니다. 승인하면 문서가 되돌아갑니다')
      navigate(`/approvals/${id}`)
    },
    onSettled: () => setConfirming(false),
  })

  if (versions.isPending) return <Spinner />
  if (versions.isError) return <ErrorState error={versions.error} onRetry={() => versions.refetch()} />
  if (items.length === 0) {
    return (
      <Sheet>
        <EmptyState title="저장된 버전이 없습니다">문서 작업을 적용하면 버전이 쌓입니다.</EmptyState>
      </Sheet>
    )
  }

  const rollbackBlockedReason = isCurrent
    ? '지금 적용된 버전입니다. 되돌릴 이전 버전을 고르세요'
    : !appliedBy
      ? '이 문서를 적용한 요청이 없어 되돌릴 수 없습니다'
      : null

  return (
    <div className="flex flex-col gap-4">
      {rollbackBlocked && appliedBy && (
        <Banner tone="warning" title="지금은 이 문서를 롤백할 수 없습니다">
          이 문서를 마지막으로 적용한{' '}
          <Link to={`/requests/${appliedBy}`} className="underline">
            요청
          </Link>
          이 이미 롤백을 마쳤거나 진행 중입니다. 이전 내용으로 되돌리려면 작업 요청에서 문서 수정을 새 요청으로 만들어 주세요.
        </Banner>
      )}
      <Sheet
        title={
          <>
            {document.title} <span className="ml-1 font-normal text-ink-3">v{selected}</span>
          </>
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            internalOnly
            disabled={Boolean(rollbackBlockedReason)}
            disabledReason={rollbackBlockedReason}
            onClick={() => setConfirming(true)}
          >
            이 버전으로 롤백
          </Button>
        }
      >
        <p className="mb-3 text-[0.8125rem] text-ink-3">
          <Mono>{document.path}</Mono>
        </p>
        <VersionView key={selected} document={document} version={selected} />
      </Sheet>

      <Sheet title="버전 목록" flush>
        <div className="overflow-x-auto">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>버전</th>
                <th>적용 시각</th>
                <th>적용한 사람</th>
                <th>적용한 요청</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.version}
                  data-clickable="true"
                  aria-selected={item.version === selected}
                  className={item.version === selected ? 'bg-seal-soft' : ''}
                  onClick={() => setSearchParams({ v: String(item.version) }, { replace: true })}
                >
                  <td>
                    <button
                      type="button"
                      className="font-medium text-seal hover:underline"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSearchParams({ v: String(item.version) }, { replace: true })
                      }}
                    >
                      v{item.version}
                    </button>
                    {item.version === document.currentVersion && (
                      <span className="ml-2 text-xs text-ink-3">현재 적용</span>
                    )}
                  </td>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{item.createdBy.name}</td>
                  <td>
                    {item.requestId ? (
                      <Link
                        to={`/requests/${item.requestId}`}
                        onClick={(event) => event.stopPropagation()}
                        className="font-mono text-[0.8125rem] text-seal hover:underline"
                      >
                        {item.requestId}
                      </Link>
                    ) : (
                      <span className="text-ink-3">요청 없이 등록</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        <p>
          바로 되돌리지 않습니다. 롤백 Plan도 같은 승인 절차(해시 확인, 서명, 실행기 검증)를 거친 뒤 실행되며, 실행되면 새
          버전으로 저장됩니다.
        </p>
        <p className="mt-2">코드·DB·배포 작업은 롤백 기능이 없고, 문서만 되돌릴 수 있습니다.</p>
      </ConfirmModal>
    </div>
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
            <ul className="mt-1">
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
        <div className="grid grid-cols-[16rem_minmax(0,1fr)] items-start gap-4 max-md:grid-cols-1">
          <Sheet title="문서 목록" flush>
            {listed.length === 0 ? (
              <EmptyState title="문서가 없습니다">문서 작업을 적용하면 여기에 나타납니다.</EmptyState>
            ) : (
              <ul>
                {listed.map((document) => (
                  <li key={document.id} className="border-b border-rule last:border-b-0">
                    <Link
                      to={`/documents/${document.id}`}
                      aria-current={document.id === documentId ? 'page' : undefined}
                      className={`block px-4 py-2.5 text-sm hover:bg-sheet-alt ${
                        document.id === documentId ? 'bg-seal-soft font-medium text-seal-dark' : ''
                      }`}
                    >
                      {document.title}
                      <span className="mt-0.5 block text-xs font-normal text-ink-3">
                        v{document.currentVersion}, {formatDateTime(document.updatedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Sheet>

          {selected ? (
            <DocumentDetail key={selected.id} document={selected} />
          ) : (
            <Sheet>
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
