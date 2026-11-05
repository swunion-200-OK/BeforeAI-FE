import { useMutation, useQueries } from '@tanstack/react-query'
import { ChevronDown, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { forbiddenApi, type ForbiddenInput } from '../../api/endpoints'
import type { ForbiddenProposal, ForbiddenProposalStatus, ForbiddenRule } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { toast } from '../../components/toast'
import {
  Banner,
  Button,
  ConfirmModal,
  ErrorState,
  Field,
  Modal,
  Mono,
  ReasonModal,
  Select,
  Sheet,
  Spinner,
} from '../../components/ui'
import { UNSIGNED_POLICY_NOTICE, adminKeyMissingReason, policyAdminProof } from '../../crypto/adminProof'
import { TASK_TYPE_LABEL } from '../../lib/labels'
import { useDepartmentNames, useDepartments, useRefreshAll } from '../../lib/queries'
import { AdminKeyNotice } from '../admin/AdminKeyNotice'
import { proposalsQuery } from '../admin/adminQueries'
import { onPolicyError } from '../admin/policyChange'
import { ForbiddenFields } from './ForbiddenFields'
import { EMPTY_FORBIDDEN_INPUT, addRuleBlockedReason, isForbiddenInputComplete } from './forbiddenInput'
import { ForbiddenRuleTable, RELEASE_PENDING_NOTICE } from './ForbiddenRuleTable'

const STATUSES: ForbiddenProposalStatus[] = ['OPEN', 'CONFIRMED', 'REJECTED']

function AddRuleModal({ onClose }: { onClose: () => void }) {
  const me = useMe()
  const refresh = useRefreshAll()
  const { data: departments, isPending: departmentsPending, isError: departmentsFailed } = useDepartments()
  const [departmentId, setDepartmentId] = useState('')
  const [input, setInput] = useState<ForbiddenInput>(EMPTY_FORBIDDEN_INPUT)
  const selected = departmentId || departments?.[0]?.id || ''
  const blockedReason = addRuleBlockedReason({
    departmentsPending,
    departmentsFailed,
    hasDepartment: Boolean(selected),
    inputComplete: isForbiddenInputComplete(input),
  })
  // 잠긴 버튼의 이유는 툴팁뿐이라 입력과 상관없는 이유는 창 안에 바로 보여 준다.
  const noDepartment = !departmentsPending && !selected
  const finish = async () => {
    await refresh()
    onClose()
  }
  const add = useMutation({
    mutationFn: () => forbiddenApi.addRule({ ...input, departmentId: selected, adminProof: policyAdminProof(me.id) }),
    meta: { silent: true },
    onSuccess: async () => {
      toast.success('금지 규칙을 추가했습니다. 웹쉘 정책에도 바로 반영됩니다')
      await finish()
    },
    onError: onPolicyError(finish),
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
            disabled={Boolean(blockedReason)}
            disabledReason={blockedReason}
            loading={add.isPending}
            onClick={() => add.mutate()}
          >
            규칙 추가
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {noDepartment && <Banner tone="warning">{blockedReason}</Banner>}
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
        <p className="text-sm text-ink-3">{UNSIGNED_POLICY_NOTICE}</p>
      </div>
    </Modal>
  )
}

/** 제안 표. 마지막 칸은 처리할 제안이면 확정·반려 버튼, 지난 제안이면 결과다. */
function ProposalTable({
  proposals,
  renderLast,
}: {
  proposals: ForbiddenProposal[]
  renderLast: (proposal: ForbiddenProposal, index: number) => ReactNode
}) {
  const departmentName = useDepartmentNames()
  return (
    <div className="overflow-x-auto">
      <table className="sheet-table [&_td]:py-3">
        <thead>
          <tr>
            <th>유형</th>
            <th>대상</th>
            <th>사유</th>
            <th>부서</th>
            <th aria-label="처리" />
          </tr>
        </thead>
        <tbody>
          {proposals.map((proposal, index) => (
            <tr key={proposal.id}>
              <td className="whitespace-nowrap">{TASK_TYPE_LABEL[proposal.taskType]}</td>
              <td>
                <Mono className="whitespace-nowrap">{proposal.target}</Mono>
              </td>
              <td className="min-w-40">{proposal.reason}</td>
              <td className="whitespace-nowrap">{departmentName(proposal.departmentId)}</td>
              <td className="text-right">{renderLast(proposal, index)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OpenProposals({ proposals }: { proposals: ForbiddenProposal[] }) {
  const me = useMe()
  const refresh = useRefreshAll()
  const departmentName = useDepartmentNames()
  const [confirming, setConfirming] = useState<ForbiddenProposal | null>(null)
  const [rejecting, setRejecting] = useState<ForbiddenProposal | null>(null)
  const finishConfirm = async () => {
    setConfirming(null)
    await refresh()
  }
  const confirm = useMutation({
    mutationFn: (proposal: ForbiddenProposal) => forbiddenApi.confirm(proposal.id, policyAdminProof(me.id)),
    meta: { silent: true },
    onSuccess: async () => {
      toast.success('제안을 확정했습니다. 서비스 정책과 웹쉘 정책에 반영됩니다')
      await finishConfirm()
    },
    onError: onPolicyError(finishConfirm),
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
    <Sheet title={`검토할 제안 ${proposals.length}건`} flush>
      <ProposalTable
        proposals={proposals}
        renderLast={(proposal, index) => (
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant={index === 0 ? 'primary' : 'secondary'}
              disabled={Boolean(adminKeyMissingReason(me.id))}
              disabledReason={adminKeyMissingReason(me.id)}
              onClick={() => setConfirming(proposal)}
            >
              확정
            </Button>
            <Button size="sm" onClick={() => setRejecting(proposal)}>
              반려
            </Button>
          </div>
        )}
      />
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
            <p className="mt-2">확정하면 서비스 정책과 웹쉘 정책에 함께 반영됩니다. {UNSIGNED_POLICY_NOTICE}</p>
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

function PastProposals({ proposals }: { proposals: ForbiddenProposal[] }) {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        지난 제안 보기 ({proposals.length}건)
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-3">
        <Sheet flush>
          <ProposalTable
            proposals={proposals}
            renderLast={(proposal) => (
              <span className={`whitespace-nowrap ${proposal.status === 'REJECTED' ? 'text-high' : 'text-ink-2'}`}>
                {proposal.status === 'REJECTED' ? '반려' : '확정'}
              </span>
            )}
          />
        </Sheet>
      </div>
    </details>
  )
}

function RulesSection({
  rules,
  loading,
  error,
  onRetry,
  primaryAdd,
}: {
  rules: ForbiddenRule[]
  loading: boolean
  error: unknown
  onRetry: () => void
  /** 처리할 제안이 있으면 그쪽이 주인공이라 직접 추가는 조용히 둔다. */
  primaryAdd: boolean
}) {
  const me = useMe()
  const refresh = useRefreshAll()
  const [adding, setAdding] = useState(false)
  const [releasing, setReleasing] = useState<ForbiddenRule | null>(null)
  const finishRelease = async () => {
    setReleasing(null)
    await refresh()
  }
  const release = useMutation({
    // 해제 요청은 adminProof가 선택이라 자리 표시 값을 보내지 않는다. 서버가 요청만 저장하고 다음 정책 변경 때 웹쉘에 함께 보낸다.
    mutationFn: ({ rule, reason }: { rule: ForbiddenRule; reason: string }) => forbiddenApi.release(rule.id, { reason }),
    meta: { silent: true },
    onSuccess: async () => {
      toast.info(`해제를 요청했습니다. ${RELEASE_PENDING_NOTICE}`)
      await finishRelease()
    },
    onError: onPolicyError(finishRelease),
  })

  return (
    <Sheet
      title={loading ? '확정 규칙' : `확정 규칙 ${rules.length}건`}
      flush
      actions={
        <Button
          variant={primaryAdd ? 'primary' : 'secondary'}
          disabled={Boolean(adminKeyMissingReason(me.id))}
          disabledReason={adminKeyMissingReason(me.id)}
          onClick={() => setAdding(true)}
        >
          <Plus size={15} aria-hidden />
          직접 추가
        </Button>
      }
    >
      {loading && <Spinner />}
      {Boolean(error) && <ErrorState error={error} onRetry={onRetry} />}
      {!loading && !error && (
        <ForbiddenRuleTable
          rules={rules}
          showDepartment
          renderAction={(rule) =>
            rule.status === 'CONFIRMED' && (
              <Button size="sm" onClick={() => setReleasing(rule)}>
                해제 요청
              </Button>
            )
          }
        />
      )}
      {adding && <AddRuleModal onClose={() => setAdding(false)} />}
      <ReasonModal
        open={Boolean(releasing)}
        title="금지 규칙 해제 요청"
        description={
          releasing && (
            <>
              <Mono>{releasing.target}</Mono> 금지 규칙의 해제를 요청합니다. 요청만으로는 풀리지 않습니다. 상태가 해제 대기로 바뀌고,{' '}
              {RELEASE_PENDING_NOTICE}.
            </>
          )
        }
        label="해제 사유"
        confirmLabel="해제 요청"
        danger={false}
        loading={release.isPending}
        onClose={() => setReleasing(null)}
        onConfirm={(reason) => releasing && release.mutate({ rule: releasing, reason })}
      />
    </Sheet>
  )
}

/** 관리자의 금지 작업 관리: 제안 확정·반려, 직접 추가, 부서별 규칙, 해제 요청 (5.7, ADM-05) */
export function ForbiddenAdminPanel() {
  const { data: departments } = useDepartments()
  const proposalResults = useQueries({ queries: STATUSES.map((status) => proposalsQuery(status)) })
  const ruleResults = useQueries({
    queries: (departments ?? []).map((department) => ({
      queryKey: ['forbidden-rules', department.id],
      queryFn: async () => (await forbiddenApi.rules(department.id)).items,
    })),
  })

  const open = proposalResults[0].data ?? []
  const past = [...(proposalResults[1].data ?? []), ...(proposalResults[2].data ?? [])]
  const proposalError = proposalResults.find((result) => result.isError)
  const ruleError = ruleResults.find((result) => result.isError)

  return (
    <div className="flex flex-col gap-4">
      <AdminKeyNotice />
      {proposalError && (
        <Sheet title="제안">
          <ErrorState error={proposalError.error} onRetry={() => proposalError.refetch()} />
        </Sheet>
      )}
      {open.length > 0 && <OpenProposals proposals={open} />}
      <RulesSection
        rules={ruleResults.flatMap((result) => result.data ?? [])}
        loading={!departments || ruleResults.some((result) => result.isPending)}
        error={ruleError?.error}
        onRetry={() => ruleError?.refetch()}
        primaryAdd={open.length === 0}
      />
      {past.length > 0 && <PastProposals proposals={past} />}
    </div>
  )
}
