import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { adminApi, orgApi } from '../../api/endpoints'
import { ApiError } from '../../api/errors'
import type { ApprovalMatrixRule, ApproverRule, PolicyPreset, Risk, TaskType } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { RiskBadge } from '../../components/badges'
import { SegmentedTabs } from '../../components/rich'
import { Button, ConfirmModal, EmptyState, ErrorState, Select, Sheet, Spinner } from '../../components/ui'
import { unsignedPolicyNotice, adminKeyMissingReason, policyAdminProof } from '../../crypto/adminProof'
import { PRESET_LABEL, RISK_LABEL, RULE_LABEL, TASK_TYPE_LABEL } from '../../lib/labels'
import { useRefreshAll } from '../../lib/queries'
import { withoutSlackOnServer } from '../../lib/serverFeatures'
import { AdminKeyNotice } from './AdminKeyNotice'
import { policyQuery } from './adminQueries'
import { notifyPolicySaved, onPolicyError } from './policyChange'

const PRESETS: PolicyPreset[] = ['SMALL', 'MEDIUM', 'LARGE']

interface PresetDetail {
  lowApprover: string
  highApprover: string
  highApprovals: number
  slack: string
  audit: string
}

/** 기능 명세서 5.5 규모별 기본 정책 */
const PRESET_DETAILS: Record<PolicyPreset, PresetDetail> = {
  SMALL: { lowApprover: '요청자 본인', highApprover: '담당자 1인', highApprovals: 1, slack: '선택', audit: '90일' },
  MEDIUM: {
    lowApprover: '요청자 본인',
    highApprover: '담당자 + 부서 관리자',
    highApprovals: 2,
    slack: '기본 켜짐',
    audit: '1년',
  },
  LARGE: {
    lowApprover: '요청자 외 같은 부서 1인',
    highApprover: '담당자 + 부서 관리자 + 관리자',
    highApprovals: 3,
    slack: '기본 켜짐',
    audit: '3년',
  },
}

const PRESET_COMPARISON = withoutSlackOnServer<{ label: string; value: (detail: PresetDetail) => string }>(
  [
    { label: '위험도 낮음·중간 작업 승인', value: (detail) => detail.lowApprover },
    { label: '위험도 높음 작업 승인', value: (detail) => detail.highApprover },
    { label: '위험도 높음 승인 인원', value: (detail) => `${detail.highApprovals}명` },
    { label: 'Slack 알림', value: (detail) => detail.slack },
    { label: '감사 로그 보관', value: (detail) => detail.audit },
  ],
  (row) => row.label === 'Slack 알림',
)

const EDITABLE_RISKS: Risk[] = ['LOW', 'MEDIUM', 'HIGH']
const EDITABLE_RULES: ApproverRule[] = ['ANYONE', 'PROJECT_OWNER']

/** 서버 기준표에는 유형과 위험도, 승인권자만 있다. 예시는 화면 설명이다 (기능 명세서 5.2). */
const TASK_TYPE_EXAMPLES: Record<TaskType, string> = {
  DOC: '문서, 주석',
  CODE_MINOR: '테스트 코드 추가, 리팩터링',
  CODE_FEATURE: '기능 코드, 의존성 변경',
  DATA_READ: '운영 데이터 읽기',
  DATA_WRITE: '운영 데이터 쓰기·삭제',
  DB: '스키마 변경, 마이그레이션',
  DEPLOY: '운영·스테이징 배포',
}

/** 프리셋을 한 번도 적용하지 않은 서버는 정책과 기준표 조회에 404로 답한다. */
const noPolicyYet = (error: unknown) => error instanceof ApiError && error.code === 'NOT_FOUND'

/** 안내 한 문장과 그 칸의 버튼 */
function SectionBar({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink-2">{text}</p>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function PresetCard({
  preset,
  selected,
  applied,
  onSelect,
}: {
  preset: PolicyPreset
  selected: boolean
  applied: boolean
  onSelect: () => void
}) {
  const detail = PRESET_DETAILS[preset]
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border p-4 transition-colors ${
        selected ? 'border-seal ring-1 ring-seal' : 'border-rule hover:border-rule-strong'
      }`}
    >
      <span className="mb-1 flex items-center gap-2">
        <input
          type="radio"
          name="preset"
          aria-label={PRESET_LABEL[preset]}
          className="accent-seal"
          checked={selected}
          onChange={onSelect}
        />
        <span className="text-base font-semibold text-ink">{PRESET_LABEL[preset]}</span>
        {applied && <span className="ml-auto text-sm font-medium text-seal">적용 중</span>}
      </span>
      <span className="text-sm text-ink-2">낮음·중간은 {detail.lowApprover}</span>
      <span className="text-sm text-ink-2">높음은 {detail.highApprover}</span>
    </label>
  )
}

function PresetComparison() {
  return (
    <details className="group mt-4">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-sm font-medium text-seal hover:underline [&::-webkit-details-marker]:hidden">
        자세히
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="sheet-table">
          <thead>
            <tr>
              <th aria-label="항목" />
              {PRESETS.map((preset) => (
                <th key={preset}>{PRESET_LABEL[preset]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRESET_COMPARISON.map((row) => (
              <tr key={row.label}>
                <td className="whitespace-nowrap text-ink-2">{row.label}</td>
                {PRESETS.map((preset) => (
                  <td key={preset}>{row.value(PRESET_DETAILS[preset])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function PresetSection() {
  const me = useMe()
  const refresh = useRefreshAll()
  const [choice, setChoice] = useState<PolicyPreset | null>(null)
  const [confirming, setConfirming] = useState(false)
  const policy = useQuery(policyQuery)
  const applied = policy.data?.preset ?? null
  const selected = choice ?? applied ?? 'SMALL'
  const finish = async () => {
    setChoice(null)
    setConfirming(false)
    await refresh()
  }
  const apply = useMutation({
    mutationFn: () => adminApi.applyPreset(selected, policyAdminProof(me.id)),
    meta: { silent: true },
    onSuccess: async (result) => {
      notifyPolicySaved(`${PRESET_LABEL[result.preset]} 프리셋을 적용했습니다`, result.webshellApplied)
      await finish()
    },
    onError: onPolicyError(finish),
  })

  if (policy.isPending) return <Spinner />
  if (policy.isError && !noPolicyYet(policy.error)) return <ErrorState error={policy.error} onRetry={() => policy.refetch()} />

  return (
    <Sheet>
      <SectionBar
        text={
          applied
            ? '프리셋을 적용하면 회사 규모에 맞는 승인 기준표로 바뀝니다.'
            : '아직 적용한 프리셋이 없습니다. 프리셋을 적용해야 승인 기준표와 금지 작업을 쓸 수 있습니다.'
        }
      >
        <Button
          variant="primary"
          disabled={selected === applied || Boolean(adminKeyMissingReason(me.id))}
          disabledReason={selected === applied ? '지금 적용된 프리셋입니다' : adminKeyMissingReason(me.id)}
          onClick={() => setConfirming(true)}
        >
          프리셋 적용
        </Button>
      </SectionBar>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {PRESETS.map((preset) => (
          <PresetCard
            key={preset}
            preset={preset}
            selected={preset === selected}
            applied={preset === applied}
            onSelect={() => setChoice(preset)}
          />
        ))}
      </div>
      <PresetComparison />
      <ConfirmModal
        open={confirming}
        title={`${PRESET_LABEL[selected]} 프리셋 적용`}
        confirmLabel="프리셋 적용"
        loading={apply.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => apply.mutate()}
      >
        {/* TODO(spec): 진행 중인 요청을 어떻게 다룰지 명세에 없다. 명세 5장대로 웹쉘은 실행 직전의 정책으로 검증한다. */}
        웹쉘 정책으로 배포됩니다. 웹쉘은 실행 직전에 새 승인 인원으로 검증하므로, 인원이 늘면 진행 중인 요청은 검증에 실패할 수 있습니다. {unsignedPolicyNotice()}
      </ConfirmModal>
    </Sheet>
  )
}

/** 승인권자 칸은 한 사람 규칙만 고칠 수 있다. 서버 프리셋의 여러 사람 규칙은 그대로 보여 주고 그대로 돌려보낸다. */
const withApprover = (row: ApprovalMatrixRule, rule: ApproverRule): ApprovalMatrixRule =>
  row.requiredApprovers.length === 1 ? { ...row, requiredApprovers: [{ rule, count: row.requiredApprovers[0].count }] } : row

/** 승인권자는 위험도로 정해진다: 높음은 담당자로 고정, 높음에서 내리면 누구나로 돌아간다 (5.2). */
function withRisk(row: ApprovalMatrixRule, risk: Risk): ApprovalMatrixRule {
  const next = { ...row, risk }
  if (risk === 'HIGH') return withApprover(next, 'PROJECT_OWNER')
  return row.risk === 'HIGH' ? withApprover(next, 'ANYONE') : next
}

function MatrixSection() {
  const me = useMe()
  const refresh = useRefreshAll()
  const [draft, setDraft] = useState<ApprovalMatrixRule[] | null>(null)
  const [confirming, setConfirming] = useState(false)
  const matrix = useQuery({
    queryKey: ['approval-matrix'],
    queryFn: async () => (await orgApi.approvalMatrix()).rules,
  })
  const rows = draft ?? matrix.data
  const dirty = Boolean(draft) && JSON.stringify(draft) !== JSON.stringify(matrix.data)
  const finish = async () => {
    setDraft(null)
    setConfirming(false)
    await refresh()
  }
  const save = useMutation({
    mutationFn: () => adminApi.updateMatrix(rows as ApprovalMatrixRule[], policyAdminProof(me.id)),
    meta: { silent: true },
    onSuccess: async (result) => {
      notifyPolicySaved('승인 기준표를 저장했습니다', result.webshellApplied)
      await finish()
    },
    onError: onPolicyError(finish),
  })

  const updateRow = (index: number, next: ApprovalMatrixRule) => {
    setDraft((rows ?? []).map((row, at) => (at === index ? next : row)))
  }

  const changed = (row: ApprovalMatrixRule, index: number) => {
    const saved = matrix.data?.[index]
    return Boolean(saved) && JSON.stringify(saved) !== JSON.stringify(row)
  }

  const missingPolicy = matrix.isError && noPolicyYet(matrix.error)

  return (
    <Sheet flush>
      <div className="px-4 py-3">
        <SectionBar text="AI는 내용에 따라 위험도를 올리기만 할 수 있고, 기본값보다 내리지는 못합니다.">
          {dirty && <Button onClick={() => setDraft(null)}>되돌리기</Button>}
          <Button
            variant="primary"
            disabled={!dirty || Boolean(adminKeyMissingReason(me.id))}
            disabledReason={!dirty ? '바뀐 내용이 없습니다' : adminKeyMissingReason(me.id)}
            onClick={() => setConfirming(true)}
          >
            기준표 저장
          </Button>
        </SectionBar>
      </div>
      {matrix.isPending && <Spinner />}
      {missingPolicy && <EmptyState title="아직 승인 기준표가 없습니다">규모 프리셋을 먼저 적용해 주세요.</EmptyState>}
      {matrix.isError && !missingPolicy && <ErrorState error={matrix.error} onRetry={() => matrix.refetch()} />}
      {rows && (
        <div className="overflow-x-auto">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>작업 유형</th>
                <th>예시</th>
                <th>위험도</th>
                <th>승인권자</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const label = TASK_TYPE_LABEL[row.taskType]
                const [only, ...others] = row.requiredApprovers
                // 서버 프리셋이 정한 규칙은 고를 수 있는 값이 아니어도 그대로 보여 준다.
                const ruleOptions = only && !EDITABLE_RULES.includes(only.rule) ? [only.rule, ...EDITABLE_RULES] : EDITABLE_RULES
                return (
                  <tr key={`${row.taskType}-${index}`}>
                    <td className="font-medium whitespace-nowrap">
                      {label}
                      {changed(row, index) && <span className="ml-2 text-[0.875rem] font-medium text-seal">바뀜</span>}
                    </td>
                    <td className="text-ink-2">{TASK_TYPE_EXAMPLES[row.taskType]}</td>
                    <td>
                      {row.risk === 'FORBIDDEN' ? (
                        <RiskBadge risk="FORBIDDEN" />
                      ) : (
                        <div className="w-28">
                          <Select
                            aria-label={`${label} 위험도`}
                            value={row.risk}
                            onChange={(event) => updateRow(index, withRisk(row, event.target.value as Risk))}
                          >
                            {EDITABLE_RISKS.map((risk) => (
                              <option key={risk} value={risk}>
                                {RISK_LABEL[risk]}
                              </option>
                            ))}
                          </Select>
                        </div>
                      )}
                    </td>
                    <td>
                      {only && others.length === 0 ? (
                        <div className="w-44">
                          <Select
                            aria-label={`${label} 승인권자`}
                            value={only.rule}
                            disabled={row.risk === 'HIGH'}
                            title={row.risk === 'HIGH' ? '위험도 높음은 프로젝트 담당자가 승인합니다' : undefined}
                            onChange={(event) => updateRow(index, withApprover(row, event.target.value as ApproverRule))}
                          >
                            {ruleOptions.map((rule) => (
                              <option key={rule} value={rule}>
                                {RULE_LABEL[rule]}
                              </option>
                            ))}
                          </Select>
                        </div>
                      ) : (
                        <span className="text-ink-2">{row.requiredApprovers.map((approver) => RULE_LABEL[approver.rule]).join(' + ')}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              <tr>
                <td className="font-medium whitespace-nowrap">부서 금지 작업</td>
                <td className="text-ink-2">금지 목록에 있는 작업</td>
                <td>
                  <RiskBadge risk="FORBIDDEN" />
                </td>
                <td className="text-ink-2">승인 불가 (실행 차단)</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <ConfirmModal
        open={confirming}
        title="승인 기준표 저장"
        confirmLabel="기준표 저장"
        loading={save.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => save.mutate()}
      >
        웹쉘 정책으로 배포됩니다. 웹쉘은 실행 직전에 새 기준표로 검증하므로, 승인권자가 늘면 진행 중인 요청은 검증에 실패할 수 있습니다. {unsignedPolicyNotice()}
      </ConfirmModal>
    </Sheet>
  )
}

type Segment = 'preset' | 'matrix'

const SEGMENTS: Array<{ id: Segment; label: string }> = [
  { id: 'preset', label: '규모 프리셋' },
  { id: 'matrix', label: '승인 기준표' },
]

export function PolicyTab() {
  const [segment, setSegment] = useState<Segment>('preset')
  return (
    <div className="flex flex-col gap-4">
      <AdminKeyNotice />
      <div>
        <SegmentedTabs<Segment> label="정책 항목" value={segment} onChange={setSegment} items={SEGMENTS} />
      </div>
      {/* 고치던 기준표가 칸을 오가도 남도록 둘 다 띄워 두고 숨긴다. */}
      <div role="tabpanel" aria-label={SEGMENTS[0].label} hidden={segment !== 'preset'}>
        <PresetSection />
      </div>
      <div role="tabpanel" aria-label={SEGMENTS[1].label} hidden={segment !== 'matrix'}>
        <MatrixSection />
      </div>
    </div>
  )
}
