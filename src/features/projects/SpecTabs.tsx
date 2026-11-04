import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { projectsApi } from '../../api/endpoints'
import type { ChangeRequestStatus, Project, ProjectSpec, SpecChangeRequest } from '../../api/types'
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
  Select,
  Sheet,
  Spinner,
  TextArea,
} from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { useRefreshAll } from '../../lib/queries'

function SpecBody({ body }: { body: string }) {
  return (
    <pre className="max-w-[80ch] overflow-x-auto font-sans text-sm leading-relaxed whitespace-pre-wrap text-ink">
      {body}
    </pre>
  )
}

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
  const spec = useQuery({ queryKey: ['project-spec', project.id], queryFn: () => projectsApi.spec(project.id) })
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
        <p className="mb-3 text-[0.8125rem] text-ink-3">
          {spec.data.updatedBy.name}, {formatDateTime(spec.data.updatedAt)}
        </p>
        {editing ? (
          <TextArea
            aria-label="기획서 본문"
            rows={18}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="font-mono"
          />
        ) : (
          <SpecBody body={spec.data.body} />
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
                  <td>{version.updatedBy.name}</td>
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
        {viewing && <SpecBody body={viewing.body} />}
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
const CR_STATUS_CLASS: Record<ChangeRequestStatus, string> = {
  OPEN: 'bg-seal-soft text-seal-dark',
  ACCEPTED: 'bg-low-soft text-low',
  REJECTED: 'bg-high-soft text-high',
}

export function ChangeRequestsTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const refreshAll = useRefreshAll()
  const [status, setStatus] = useState<ChangeRequestStatus | ''>('')
  const [rejecting, setRejecting] = useState<SpecChangeRequest | null>(null)
  const [requesting, setRequesting] = useState(false)
  const list = useQuery({
    queryKey: ['project-change-requests', project.id, status],
    queryFn: async () => (await projectsApi.changeRequests(project.id, status || undefined)).items,
  })
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

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="w-40">
          <Select
            aria-label="처리 상태"
            value={status}
            onChange={(event) => setStatus(event.target.value as ChangeRequestStatus | '')}
          >
            <option value="">전체 상태</option>
            {(Object.keys(CR_STATUS_LABEL) as ChangeRequestStatus[]).map((value) => (
              <option key={value} value={value}>
                {CR_STATUS_LABEL[value]}
              </option>
            ))}
          </Select>
        </div>
        {!canEdit && <Button onClick={() => setRequesting(true)}>수정 요청</Button>}
      </div>

      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <Sheet>
          <EmptyState title="수정 요청이 없습니다">
            {canEdit ? '직원이 수정 요청을 보내면 여기에서 반영하거나 반려합니다.' : '기획서에 고칠 점이 있으면 수정 요청을 보내세요.'}
          </EmptyState>
        </Sheet>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.map((item) => (
            <li key={item.id}>
              <Sheet>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-[0.8125rem] text-ink-2">
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${CR_STATUS_CLASS[item.status]}`}>
                      {CR_STATUS_LABEL[item.status]}
                    </span>
                    {item.requester.name}, {formatDateTime(item.createdAt)}
                  </p>
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
                <h3 className="mt-3 text-[0.8125rem] font-medium text-ink-3">변경 내용</h3>
                <div className="mt-1">
                  <SpecBody body={item.content} />
                </div>
                <h3 className="mt-3 text-[0.8125rem] font-medium text-ink-3">사유</h3>
                <p className="mt-1 max-w-[80ch] text-sm">{item.reason}</p>
                {item.rejectReason && (
                  <div className="mt-3">
                    <Banner tone="neutral" title="반려 사유">
                      {item.rejectReason}
                    </Banner>
                  </div>
                )}
              </Sheet>
            </li>
          ))}
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
