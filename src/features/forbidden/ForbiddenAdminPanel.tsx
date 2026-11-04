import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { forbiddenApi, type ForbiddenInput } from '../../api/endpoints'
import type { ForbiddenProposal, ForbiddenProposalStatus, ForbiddenRule } from '../../api/types'
import { TaskTypeTag } from '../../components/badges'
import { toast } from '../../components/toast'
import {
  Banner,
  Button,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Mono,
  ReasonModal,
  Select,
  Sheet,
  Spinner,
} from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { useDepartmentNames, useDepartments, useRefreshAll } from '../../lib/queries'
import { EMPTY_FORBIDDEN_INPUT, ForbiddenFields, isForbiddenInputComplete } from './ForbiddenFields'
import { ForbiddenRuleTable, RELEASE_PENDING_NOTICE } from './ForbiddenRuleTable'

const PROPOSAL_STATUS_LABEL: Record<ForbiddenProposalStatus, string> = {
  OPEN: '검토 대기',
  CONFIRMED: '확정',
  REJECTED: '반려',
}

const PROPOSAL_STATUS_CLASS: Record<ForbiddenProposalStatus, string> = {
  OPEN: 'bg-seal-soft text-seal-dark',
  CONFIRMED: 'bg-forbidden-soft text-forbidden',
  REJECTED: 'bg-high-soft text-high',
}

function AddRuleModal({ onClose }: { onClose: () => void }) {
  const refresh = useRefreshAll()
  const { data: departments } = useDepartments()
  const [departmentId, setDepartmentId] = useState('')
  const [input, setInput] = useState<ForbiddenInput>(EMPTY_FORBIDDEN_INPUT)
  const selected = departmentId || departments?.[0]?.id || ''
  const add = useMutation({
    mutationFn: () => forbiddenApi.addRule({ ...input, departmentId: selected }),
    onSuccess: async () => {
      toast.success('금지 규칙을 추가했습니다. 실행기 로컬 정책에도 바로 반영됩니다')
      await refresh()
      onClose()
    },
  })
  return (
    <Modal
      open
      title="금지 규칙 직접 추가"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button
            variant="primary"
            disabled={!selected || !isForbiddenInputComplete(input)}
            disabledReason="대상과 사유를 입력해 주세요"
            loading={add.isPending}
            onClick={() => add.mutate()}
          >
            규칙 추가
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="부서">
          {(id) => (
            <Select id={id} value={selected} onChange={(event) => setDepartmentId(event.target.value)}>
              {departments?.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ForbiddenFields value={input} onChange={setInput} />
      </div>
    </Modal>
  )
}

function ProposalSection() {
  const refresh = useRefreshAll()
  const departmentName = useDepartmentNames()
  const [status, setStatus] = useState<ForbiddenProposalStatus | ''>('OPEN')
  const [confirming, setConfirming] = useState<ForbiddenProposal | null>(null)
  const [rejecting, setRejecting] = useState<ForbiddenProposal | null>(null)
  const proposals = useQuery({
    queryKey: ['admin', 'forbidden-proposals', status],
    queryFn: async () => (await forbiddenApi.proposals(status || undefined)).items,
  })
  const confirm = useMutation({
    mutationFn: (proposal: ForbiddenProposal) => forbiddenApi.confirm(proposal.id),
    onSuccess: async () => {
      toast.success('제안을 확정했습니다. 서비스 정책과 실행기 로컬 정책에 반영됩니다')
      setConfirming(null)
      await refresh()
    },
  })
  const reject = useMutation({
    mutationFn: ({ proposal, reason }: { proposal: ForbiddenProposal; reason: string }) =>
      forbiddenApi.reject(proposal.id, reason),
    onSuccess: async () => {
      toast.success('제안을 반려했습니다')
      setRejecting(null)
      await refresh()
    },
  })

  return (
    <Sheet
      title="팀장 제안"
      flush
      actions={
        <label className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
          상태
          <Select
            className="w-28"
            value={status}
            onChange={(event) => setStatus(event.target.value as ForbiddenProposalStatus | '')}
          >
            <option value="">전체</option>
            {(Object.keys(PROPOSAL_STATUS_LABEL) as ForbiddenProposalStatus[]).map((value) => (
              <option key={value} value={value}>
                {PROPOSAL_STATUS_LABEL[value]}
              </option>
            ))}
          </Select>
        </label>
      }
    >
      {proposals.isPending && <Spinner />}
      {proposals.isError && <ErrorState error={proposals.error} onRetry={() => proposals.refetch()} />}
      {proposals.data?.length === 0 && (
        <EmptyState title={status === 'OPEN' ? '검토할 제안이 없습니다' : '조건에 맞는 제안이 없습니다'} />
      )}
      {proposals.data && proposals.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>부서</th>
                <th>작업 유형</th>
                <th>대상</th>
                <th>사유</th>
                <th>제안자</th>
                <th>상태</th>
                <th aria-label="동작" />
              </tr>
            </thead>
            <tbody>
              {proposals.data.map((proposal) => (
                <tr key={proposal.id}>
                  <td className="whitespace-nowrap">{departmentName(proposal.departmentId)}</td>
                  <td>
                    <TaskTypeTag type={proposal.taskType} />
                  </td>
                  <td>
                    <Mono>{proposal.target}</Mono>
                  </td>
                  <td className="min-w-48">
                    {proposal.reason}
                    {proposal.rejectReason && (
                      <p className="mt-1 text-xs text-high">반려 사유: {proposal.rejectReason}</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-ink-2">
                    {proposal.proposer.name}
                    <br />
                    <span className="text-xs text-ink-3">{formatDateTime(proposal.createdAt)}</span>
                  </td>
                  <td>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${PROPOSAL_STATUS_CLASS[proposal.status]}`}
                    >
                      {PROPOSAL_STATUS_LABEL[proposal.status]}
                    </span>
                  </td>
                  <td>
                    {proposal.status === 'OPEN' && (
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="primary" onClick={() => setConfirming(proposal)}>
                          확정
                        </Button>
                        <Button size="sm" variant="danger-outline" onClick={() => setRejecting(proposal)}>
                          반려
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmModal
        open={Boolean(confirming)}
        title="금지 작업 확정"
        confirmLabel="확정"
        loading={confirm.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && confirm.mutate(confirming)}
      >
        {confirming && (
          <>
            <p>
              {departmentName(confirming.departmentId)}의 <Mono>{confirming.target}</Mono> 작업을 금지합니다.
            </p>
            <p className="mt-2">확정하면 서비스 정책과 실행기 로컬 정책에 함께 반영됩니다.</p>
          </>
        )}
      </ConfirmModal>
      <ReasonModal
        open={Boolean(rejecting)}
        title="제안 반려"
        label="반려 사유"
        confirmLabel="반려"
        loading={reject.isPending}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => rejecting && reject.mutate({ proposal: rejecting, reason })}
      />
    </Sheet>
  )
}

function RulesSection() {
  const refresh = useRefreshAll()
  const { data: departments } = useDepartments()
  const [adding, setAdding] = useState(false)
  const [releasing, setReleasing] = useState<ForbiddenRule | null>(null)
  const ruleQueries = useQueries({
    queries: (departments ?? []).map((department) => ({
      queryKey: ['forbidden-rules', department.id],
      queryFn: async () => (await forbiddenApi.rules(department.id)).items,
    })),
  })
  const release = useMutation({
    mutationFn: (rule: ForbiddenRule) => forbiddenApi.release(rule.id),
    onSuccess: async () => {
      toast.info(`해제를 요청했습니다. ${RELEASE_PENDING_NOTICE}`)
      setReleasing(null)
      await refresh()
    },
  })

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[0.9375rem]">부서별 금지 규칙</h2>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={15} aria-hidden />
          규칙 직접 추가
        </Button>
      </div>
      {(departments ?? []).map((department, index) => {
        const query = ruleQueries[index]
        return (
          <Sheet key={department.id} title={department.name} flush>
            {query?.isPending && <Spinner />}
            {query?.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
            {query?.data && (
              <ForbiddenRuleTable
                rules={query.data}
                renderAction={(rule) =>
                  rule.status === 'ACTIVE' && (
                    <Button size="sm" onClick={() => setReleasing(rule)}>
                      해제 요청
                    </Button>
                  )
                }
              />
            )}
          </Sheet>
        )
      })}
      {adding && <AddRuleModal onClose={() => setAdding(false)} />}
      <ConfirmModal
        open={Boolean(releasing)}
        title="금지 규칙 해제 요청"
        confirmLabel="해제 요청"
        loading={release.isPending}
        onClose={() => setReleasing(null)}
        onConfirm={() => releasing && release.mutate(releasing)}
      >
        {releasing && (
          <>
            <p>
              <Mono>{releasing.target}</Mono> 금지 규칙의 해제를 요청합니다.
            </p>
            <div className="mt-3">
              <Banner tone="warning">
                요청만으로는 풀리지 않습니다. 상태가 해제 대기로 바뀌고, {RELEASE_PENDING_NOTICE}.
              </Banner>
            </div>
          </>
        )}
      </ConfirmModal>
    </>
  )
}

/** 관리자의 금지 작업 관리: 제안 확정·반려, 직접 추가, 부서별 규칙, 해제 요청 (5.7, ADM-05) */
export function ForbiddenAdminPanel() {
  return (
    <div className="flex flex-col gap-4">
      <ProposalSection />
      <RulesSection />
    </div>
  )
}
