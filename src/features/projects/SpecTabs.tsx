import { useMutation, useQuery } from '@tanstack/react-query'
import { CircleCheck, CircleDot, CircleX, FileText, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { projectsApi } from '../../api/endpoints'
import type { ChangeRequestStatus, Project, ProjectSpec, SpecChangeRequest } from '../../api/types'
import { SegmentedTabs, UserChip } from '../../components/rich'
import { toast } from '../../components/toast'
import {
  Banner,
  Button,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  ReasonModal,
  Sheet,
  Spinner,
  TextArea,
} from '../../components/ui'
import { MarkdownText } from '../documents/MarkdownText'
import { formatDateTime } from '../../lib/format'
import { useRefreshAll } from '../../lib/queries'
import { changeRequestsQuery, specQuery } from './queries'

// ── 기획서 본문 ────────────────────────────────────────────

function ChangeRequestModal({
  open,
  projectId,
  onClose,
}: {
  open: boolean
  projectId: string
  onClose: () => void
}) {
  const refreshAll = useRefreshAll()
  const [content, setContent] = useState('')
  const [reason, setReason] = useState('')
  const send = useMutation({
    mutationFn: () => projectsApi.createChangeRequest(projectId, { content: content.trim(), reason: reason.trim() }),
    onSuccess: async () => {
      await refreshAll()
      toast.success('수정 요청을 보냈습니다. 담당 부서 팀장에게 Slack으로 알립니다')
      setContent('')
      setReason('')
      onClose()
    },
  })
  const blocked = !content.trim() || !reason.trim()
  return (
    <Modal
      open={open}
      wide
      title="기획서 수정 요청"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button
            variant="primary"
            disabled={blocked}
            disabledReason="변경 내용과 사유를 입력해 주세요"
            loading={send.isPending}
            onClick={() => send.mutate()}
          >
            수정 요청 보내기
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="변경 내용">
          {(id) => <TextArea id={id} rows={6} value={content} onChange={(event) => setContent(event.target.value)} />}
        </Field>
        <Field label="사유">
          {(id) => <TextArea id={id} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}

export function SpecTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const refreshAll = useRefreshAll()
  const [draft, setDraft] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const spec = useQuery(specQuery(project.id))
  const save = useMutation({
    mutationFn: (body: string) => projectsApi.updateSpec(project.id, body),
    onSuccess: async (saved) => {
      await refreshAll()
      setDraft(null)
      toast.success(`기획서를 v${saved.version}으로 저장했습니다`)
    },
  })

  if (spec.isPending) return <Spinner />
  if (spec.isError) return <ErrorState error={spec.error} onRetry={() => spec.refetch()} />

  const editing = draft !== null
  const unchanged = draft === spec.data.body

  return (
    <>
      <Sheet
        title={`현재 버전 v${spec.data.version}`}
        icon={<FileText size={16} aria-hidden />}
        actions={
          editing ? (
            <>
              <Button size="sm" onClick={() => setDraft(null)}>
                편집 취소
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={unchanged}
                disabledReason="바뀐 내용이 없습니다"
                loading={save.isPending}
                onClick={() => save.mutate(draft)}
              >
                새 버전으로 저장
              </Button>
            </>
          ) : canEdit ? (
            <Button size="sm" onClick={() => setDraft(spec.data.body)}>
              기획서 수정
            </Button>
          ) : (
            <Button size="sm" onClick={() => setRequesting(true)}>
              수정 요청
            </Button>
          )
        }
      >
        <div className="mb-3 border-b border-rule pb-3">
          <UserChip name={spec.data.updatedBy.name} sub={`${formatDateTime(spec.data.updatedAt)}에 저장`} />
        </div>
        {editing ? (
          <TextArea
            aria-label="기획서 본문"
            rows={18}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="font-mono"
          />
        ) : (
          <MarkdownText body={spec.data.body} />
        )}
      </Sheet>
      <ChangeRequestModal open={requesting} projectId={project.id} onClose={() => setRequesting(false)} />
    </>
  )
}

// ── 버전 ───────────────────────────────────────────────────

export function VersionsTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const refreshAll = useRefreshAll()
  const [viewing, setViewing] = useState<ProjectSpec | null>(null)
  const [restoring, setRestoring] = useState<ProjectSpec | null>(null)
  const versions = useQuery({
    queryKey: ['project-spec-versions', project.id],
    queryFn: async () => (await projectsApi.specVersions(project.id)).items,
  })
  const restore = useMutation({
    mutationFn: (version: number) => projectsApi.restoreSpec(project.id, version),
    onSuccess: async (saved) => {
      await refreshAll()
      toast.success(`이전 버전을 복원해 v${saved.version}으로 저장했습니다`)
    },
    onSettled: () => setRestoring(null),
  })

  if (versions.isPending) return <Spinner />
  if (versions.isError) return <ErrorState error={versions.error} onRetry={() => versions.refetch()} />

  const latest = versions.data[0]?.version

  return (
    <>
      <Sheet flush>
        <div className="overflow-x-auto">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>버전</th>
                <th>저장 시각</th>
                <th>저장한 사람</th>
                <th aria-label="동작" />
              </tr>
            </thead>
            <tbody>
              {versions.data.map((version) => (
                <tr key={version.version}>
                  <td className="font-medium">
                    v{version.version}
                    {version.version === latest && <span className="ml-2 text-xs font-normal text-ink-3">현재</span>}
                  </td>
                  <td>{formatDateTime(version.updatedAt)}</td>
                  <td>
                    <UserChip name={version.updatedBy.name} />
                  </td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setViewing(version)}>
                        보기
                      </Button>
                      {canEdit && version.version !== latest && (
                        <Button size="sm" onClick={() => setRestoring(version)}>
                          이 버전으로 복원
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sheet>

      <Modal open={viewing !== null} wide title={`기획서 v${viewing?.version ?? ''}`} onClose={() => setViewing(null)}>
        {viewing && <MarkdownText body={viewing.body} />}
      </Modal>

      <ConfirmModal
        open={restoring !== null}
        title={`v${restoring?.version ?? ''}을 복원할까요?`}
        confirmLabel="복원"
        loading={restore.isPending}
        onConfirm={() => restoring && restore.mutate(restoring.version)}
        onClose={() => setRestoring(null)}
      >
        지금 버전을 지우지 않고, 고른 버전의 내용으로 새 버전을 저장합니다.
      </ConfirmModal>
    </>
  )
}

// ── 수정 요청 ──────────────────────────────────────────────

const CR_STATUS_LABEL: Record<ChangeRequestStatus, string> = { OPEN: '처리 대기', ACCEPTED: '반영됨', REJECTED: '반려됨' }
const CR_STATUS_STYLE: Record<ChangeRequestStatus, { className: string; Icon: LucideIcon }> = {
  OPEN: { className: 'bg-seal-soft text-seal-dark', Icon: CircleDot },
  ACCEPTED: { className: 'bg-low-soft text-low', Icon: CircleCheck },
  REJECTED: { className: 'bg-high-soft text-high', Icon: CircleX },
}

type StatusFilter = ChangeRequestStatus | 'ALL'

export function ChangeRequestsTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const refreshAll = useRefreshAll()
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [rejecting, setRejecting] = useState<SpecChangeRequest | null>(null)
  const [requesting, setRequesting] = useState(false)
  const list = useQuery(changeRequestsQuery(project.id))
  const accept = useMutation({
    mutationFn: (crId: string) => projectsApi.acceptChangeRequest(project.id, crId),
    onSuccess: async () => {
      await refreshAll()
      toast.success('수정 요청을 반영해 새 버전을 저장했습니다')
    },
  })
  const reject = useMutation({
    mutationFn: ({ crId, reason }: { crId: string; reason: string }) =>
      projectsApi.rejectChangeRequest(project.id, crId, reason),
    onSuccess: async () => {
      await refreshAll()
      toast.success('수정 요청을 반려했습니다')
    },
    onSettled: () => setRejecting(null),
  })

  const countOf = (value: ChangeRequestStatus) => list.data?.filter((item) => item.status === value).length ?? 0
  const shown = list.data?.filter((item) => status === 'ALL' || item.status === status) ?? []

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SegmentedTabs<StatusFilter>
          label="처리 상태"
          value={status}
          onChange={setStatus}
          items={[
            { id: 'ALL', label: '전체', count: list.data?.length ?? 0 },
            ...(Object.keys(CR_STATUS_LABEL) as ChangeRequestStatus[]).map((value) => ({
              id: value,
              label: CR_STATUS_LABEL[value],
              count: countOf(value),
              icon: CR_STATUS_STYLE[value].Icon,
            })),
          ]}
        />
        {!canEdit && <Button onClick={() => setRequesting(true)}>수정 요청</Button>}
      </div>

      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : shown.length === 0 ? (
        <Sheet>
          <EmptyState title="수정 요청이 없습니다">
            {canEdit ? '직원이 수정 요청을 보내면 여기에서 반영하거나 반려합니다.' : '기획서에 고칠 점이 있으면 수정 요청을 보내세요.'}
          </EmptyState>
        </Sheet>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((item) => {
            const { className, Icon } = CR_STATUS_STYLE[item.status]
            return (
              <li key={item.id} data-change-request>
                <Sheet>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <UserChip name={item.requester.name} sub={formatDateTime(item.createdAt)} />
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${className}`}>
                        <Icon size={13} aria-hidden />
                        {CR_STATUS_LABEL[item.status]}
                      </span>
                    </div>
                    {canEdit && item.status === 'OPEN' && (
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="primary"
                          loading={accept.isPending && accept.variables === item.id}
                          onClick={() => accept.mutate(item.id)}
                        >
                          반영
                        </Button>
                        <Button size="sm" variant="danger-outline" onClick={() => setRejecting(item)}>
                          반려
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
                    <div className="min-w-0">
                      <h3 className="text-xs font-semibold text-ink-2">변경 내용</h3>
                      <div className="mt-1 rounded-lg bg-sheet-alt p-3">
                        <MarkdownText body={item.content} />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-xs font-semibold text-ink-2">사유</h3>
                      <p className="mt-1 max-w-[80ch] text-sm">{item.reason}</p>
                    </div>
                  </div>
                  {item.rejectReason && (
                    <div className="mt-3">
                      <Banner tone="neutral" title="반려 사유">
                        {item.rejectReason}
                      </Banner>
                    </div>
                  )}
                </Sheet>
              </li>
            )
          })}
        </ul>
      )}

      <ChangeRequestModal open={requesting} projectId={project.id} onClose={() => setRequesting(false)} />
      <ReasonModal
        open={rejecting !== null}
        title="수정 요청 반려"
        description="반려 사유는 요청한 직원이 봅니다."
        label="반려 사유"
        confirmLabel="반려"
        loading={reject.isPending}
        onConfirm={(reason) => rejecting && reject.mutate({ crId: rejecting.id, reason })}
        onClose={() => setRejecting(null)}
      />
    </>
  )
}
