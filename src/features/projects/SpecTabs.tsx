import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { projectsApi } from '../../api/endpoints'
import type { ChangeRequestStatus, Project, ProjectSpec, SpecChangeRequest } from '../../api/types'
import { SegmentedTabs } from '../../components/rich'
import { toast } from '../../components/toast'
import {
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

export function ChangeRequestModal({
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

/** 기획서 본문. draft가 있으면 고치는 중이고, 저장과 취소는 화면 머리글에 있다. */
export function SpecTab({
  projectId,
  draft,
  onDraftChange,
}: {
  projectId: string
  draft: string | null
  onDraftChange: (value: string) => void
}) {
  const spec = useQuery(specQuery(projectId))

  if (spec.isPending) return <Spinner />
  if (spec.isError) return <ErrorState error={spec.error} onRetry={() => spec.refetch()} />

  return (
    <>
      <p className="mb-3 text-[0.875rem] text-ink-3">
        현재 버전 v{spec.data.version}, {spec.data.updatedBy.name}, {formatDateTime(spec.data.updatedAt)}
      </p>
      <Sheet flush>
        <div className="px-8 py-6">
          {draft !== null ? (
            <TextArea
              aria-label="기획서 본문"
              rows={24}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              className="font-mono"
            />
          ) : (
            <MarkdownText body={spec.data.body} />
          )}
        </div>
      </Sheet>
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
const CR_STATUS_COLOR: Record<ChangeRequestStatus, string> = {
  OPEN: 'text-seal-dark',
  ACCEPTED: 'text-low',
  REJECTED: 'text-high',
}

type StatusFilter = ChangeRequestStatus | 'ALL'

export function ChangeRequestsTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const refreshAll = useRefreshAll()
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [rejecting, setRejecting] = useState<SpecChangeRequest | null>(null)
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

  if (list.isPending) return <Spinner />
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />
  if (list.data.length === 0) {
    return (
      <EmptyState title="수정 요청이 없습니다">
        {canEdit ? '직원이 수정 요청을 보내면 여기에서 반영하거나 반려합니다.' : '기획서에 고칠 점이 있으면 수정 요청을 보내세요.'}
      </EmptyState>
    )
  }

  const countOf = (value: ChangeRequestStatus) => list.data.filter((item) => item.status === value).length
  const shown = list.data.filter((item) => status === 'ALL' || item.status === status)

  return (
    <>
      <div className="mb-3">
        <SegmentedTabs<StatusFilter>
          label="처리 상태"
          value={status}
          onChange={setStatus}
          items={[
            { id: 'ALL', label: '전체', count: list.data.length },
            ...(Object.keys(CR_STATUS_LABEL) as ChangeRequestStatus[]).map((value) => ({
              id: value,
              label: CR_STATUS_LABEL[value],
              count: countOf(value),
            })),
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState title="이 상태의 수정 요청이 없습니다" />
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((item) => (
            <li key={item.id} data-change-request>
              <Sheet>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[0.875rem] text-ink-3">
                    <span className="font-medium text-ink">{item.requester.name}</span>, {formatDateTime(item.createdAt)},{' '}
                    <span className={`font-medium ${CR_STATUS_COLOR[item.status]}`}>{CR_STATUS_LABEL[item.status]}</span>
                  </p>
                  {canEdit && item.status === 'OPEN' && (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        loading={accept.isPending && accept.variables === item.id}
                        onClick={() => accept.mutate(item.id)}
                      >
                        반영
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRejecting(item)}>
                        반려
                      </Button>
                    </div>
                  )}
                </div>
                <p className="mt-2 max-w-[80ch] text-sm">
                  <span className="text-ink-3">사유</span> {item.reason}
                </p>
                <div className="mt-3 rounded-lg bg-sheet-alt p-3">
                  <MarkdownText body={item.content} />
                </div>
                {item.rejectReason && (
                  <p className="mt-3 max-w-[80ch] text-sm">
                    <span className="text-ink-3">반려 사유</span> {item.rejectReason}
                  </p>
                )}
              </Sheet>
            </li>
          ))}
        </ul>
      )}

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
