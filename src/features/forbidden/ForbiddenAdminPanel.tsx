import { useMutation, useQueries } from '@tanstack/react-query'
import { Hourglass, Inbox, Lock, Plus, ShieldBan, Unlock } from 'lucide-react'
import { useState } from 'react'
import { forbiddenApi, type ForbiddenInput } from '../../api/endpoints'
import type { ForbiddenProposal, ForbiddenProposalStatus, ForbiddenRule } from '../../api/types'
import { TaskTypeTag } from '../../components/badges'
import { SegmentedTabs, StatCard, UserChip } from '../../components/rich'
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
import { proposalsQuery } from '../admin/adminQueries'
import { ForbiddenFields } from './ForbiddenFields'
import { EMPTY_FORBIDDEN_INPUT, isForbiddenInputComplete } from './forbiddenInput'
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

const STATUSES = Object.keys(PROPOSAL_STATUS_LABEL) as ForbiddenProposalStatus[]

function AddRuleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const refresh = useRefreshAll()
  const { data: departments } = useDepartments()
  const [departmentId, setDepartmentId] = useState('')
  const [input, setInput] = useState<ForbiddenInput>(EMPTY_FORBIDDEN_INPUT)
  const selected = departmentId || departments?.[0]?.id || ''
  const close = () => {
    setDepartmentId('')
    setInput(EMPTY_FORBIDDEN_INPUT)
    onClose()
  }
  const add = useMutation({
    mutationFn: () => forbiddenApi.addRule({ ...input, departmentId: selected }),
    onSuccess: async () => {
      toast.success('금지 규칙을 추가했습니다. 실행기 로컬 정책에도 바로 반영됩니다')
      await refresh()
      close()
    },
  })
  return (
    <Modal
      open={open}
      title="금지 규칙 직접 추가"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>닫기</Button>
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

function ProposalCard({
  proposal,
  onConfirm,
  onReject,
}: {
  proposal: ForbiddenProposal
  onConfirm: () => void
  onReject: () => void
}) {
  const departmentName = useDepartmentNames()
  return (
    <article className="rounded-lg border border-rule bg-sheet p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[0.8125rem] font-semibold text-ink">{departmentName(proposal.departmentId)}</span>
        <TaskTypeTag type={proposal.taskType} />
        <span className="rounded bg-paper px-1.5 py-0.5">
          <Mono>{proposal.target}</Mono>
        </span>
        {proposal.status !== 'OPEN' && (
          <span className={`ml-auto rounded px-1.5 py-0.5 text-xs font-medium ${PROPOSAL_STATUS_CLASS[proposal.status]}`}>
            {PROPOSAL_STATUS_LABEL[proposal.status]}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-ink">{proposal.reason}</p>
      {proposal.rejectReason && <p className="mt-1 text-xs text-high">반려 사유: {proposal.rejectReason}</p>}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <UserChip name={proposal.proposer.name} sub={formatDateTime(proposal.createdAt)} />
        {proposal.status === 'OPEN' && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" onClick={onConfirm}>
              확정
            </Button>
            <Button size="sm" variant="danger-outline" onClick={onReject}>
              반려
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}

function ProposalSection({
  lists,
  status,
  onStatusChange,
}: {
  lists: Record<ForbiddenProposalStatus, ForbiddenProposal[] | undefined>
  status: ForbiddenProposalStatus
  onStatusChange: (status: ForbiddenProposalStatus) => void
}) {
  const refresh = useRefreshAll()
  const departmentName = useDepartmentNames()
  const [confirming, setConfirming] = useState<ForbiddenProposal | null>(null)
  const [rejecting, setRejecting] = useState<ForbiddenProposal | null>(null)
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
  const proposals = lists[status]

  return (
    <Sheet title="팀장 제안" icon={<Inbox size={16} aria-hidden />}>
      <SegmentedTabs<ForbiddenProposalStatus>
        label="제안 상태로 거르기"
        value={status}
        onChange={onStatusChange}
        items={STATUSES.map((value) => ({
          id: value,
          label: PROPOSAL_STATUS_LABEL[value],
          count: lists[value]?.length,
        }))}
      />
      <div className="mt-3 flex flex-col gap-2.5">
        {!proposals && <Spinner />}
        {proposals?.length === 0 && (
          <EmptyState title={status === 'OPEN' ? '검토할 제안이 없습니다' : '조건에 맞는 제안이 없습니다'}>
            {status === 'OPEN' ? '팀장이 금지 작업을 제안하면 여기에 나타납니다.' : undefined}
          </EmptyState>
        )}
        {proposals?.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            onConfirm={() => setConfirming(proposal)}
            onReject={() => setRejecting(proposal)}
          />
        ))}
      </div>
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

function RulesSection({ rules, loading, error, onRetry }: { rules: ForbiddenRule[]; loading: boolean; error: unknown; onRetry: () => void }) {
  const refresh = useRefreshAll()
  const [adding, setAdding] = useState(false)
  const [releasing, setReleasing] = useState<ForbiddenRule | null>(null)
  const release = useMutation({
    mutationFn: (rule: ForbiddenRule) => forbiddenApi.release(rule.id),
    onSuccess: async () => {
      toast.info(`해제를 요청했습니다. ${RELEASE_PENDING_NOTICE}`)
      setReleasing(null)
      await refresh()
    },
  })

  return (
    <Sheet
      title="부서별 금지 규칙"
      icon={<ShieldBan size={16} aria-hidden />}
      flush
      actions={
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={15} aria-hidden />
          규칙 직접 추가
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
            rule.status === 'ACTIVE' && (
              <Button size="sm" onClick={() => setReleasing(rule)}>
                해제 요청
              </Button>
            )
          }
        />
      )}
      <AddRuleModal open={adding} onClose={() => setAdding(false)} />
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
    </Sheet>
  )
}

/** 관리자의 금지 작업 관리: 제안 확정·반려, 직접 추가, 부서별 규칙, 해제 요청 (5.7, ADM-05) */
export function ForbiddenAdminPanel() {
  const { data: departments } = useDepartments()
  const [status, setStatus] = useState<ForbiddenProposalStatus>('OPEN')
  const proposalResults = useQueries({ queries: STATUSES.map((value) => proposalsQuery(value)) })
  const ruleResults = useQueries({
    queries: (departments ?? []).map((department) => ({
      queryKey: ['forbidden-rules', department.id],
      queryFn: async () => (await forbiddenApi.rules(department.id)).items,
    })),
  })

  const lists = {
    OPEN: proposalResults[0].data,
    CONFIRMED: proposalResults[1].data,
    REJECTED: proposalResults[2].data,
  }
  const proposalError = proposalResults.find((result) => result.isError)
  const rules = ruleResults.flatMap((result) => result.data ?? [])
  const activeCount = rules.filter((rule) => rule.status === 'ACTIVE').length
  const releasePending = rules.length - activeCount
  const ruleError = ruleResults.find((result) => result.isError)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="검토 대기 제안"
          value={lists.OPEN?.length ?? 0}
          icon={Hourglass}
          tone={lists.OPEN?.length ? 'amber' : 'neutral'}
          hint="확정하면 실행기 정책에도 반영됩니다"
        />
        <StatCard
          label="적용 중인 금지 규칙"
          value={activeCount}
          icon={Lock}
          tone="neutral"
          hint="Plan 단계와 실행 직전에 두 번 차단합니다"
        />
        <StatCard
          label="해제 대기"
          value={releasePending}
          icon={Unlock}
          tone={releasePending > 0 ? 'amber' : 'neutral'}
          hint="실행기 로컬 콘솔의 재확인을 기다립니다"
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[24rem_minmax(0,1fr)]">
        {proposalError ? (
          <Sheet title="팀장 제안">
            <ErrorState error={proposalError.error} onRetry={() => proposalError.refetch()} />
          </Sheet>
        ) : (
          <ProposalSection lists={lists} status={status} onStatusChange={setStatus} />
        )}
        <RulesSection
          rules={rules}
          loading={!departments || ruleResults.some((result) => result.isPending)}
          error={ruleError?.error}
          onRetry={() => ruleError?.refetch()}
        />
      </div>
    </div>
  )
}
