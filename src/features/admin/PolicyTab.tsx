import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { adminApi, orgApi } from '../../api/endpoints'
import type { ApprovalMatrixRow, ApproverRule, PolicyPreset, Risk } from '../../api/types'
import { RiskBadge } from '../../components/badges'
import { SegmentedTabs } from '../../components/rich'
import { toast } from '../../components/toast'
import { Button, ConfirmModal, ErrorState, Select, Sheet, Spinner } from '../../components/ui'
import { PRESET_LABEL, RISK_LABEL, RULE_LABEL } from '../../lib/labels'
import { useRefreshAll } from '../../lib/queries'
import { policyQuery } from './adminQueries'

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

const PRESET_COMPARISON: Array<{ label: string; value: (detail: PresetDetail) => string }> = [
  { label: '위험도 낮음·중간 작업 승인', value: (detail) => detail.lowApprover },
  { label: '위험도 높음 작업 승인', value: (detail) => detail.highApprover },
  { label: '위험도 높음 승인 인원', value: (detail) => `${detail.highApprovals}명` },
  { label: 'Slack 알림', value: (detail) => detail.slack },
  { label: '감사 로그 보관', value: (detail) => detail.audit },
]

const EDITABLE_RISKS: Array<ApprovalMatrixRow['defaultRisk']> = ['LOW', 'MEDIUM', 'HIGH']
const EDITABLE_RULES: ApproverRule[] = ['ANYONE', 'PROJECT_OWNER']

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
        selected ? 'border-seal bg-seal-soft/40 ring-1 ring-seal' : 'border-rule hover:border-rule-strong'
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
  const refresh = useRefreshAll()
  const [choice, setChoice] = useState<PolicyPreset | null>(null)
  const [confirming, setConfirming] = useState(false)
  const policy = useQuery(policyQuery)
  const selected = choice ?? policy.data?.preset ?? 'SMALL'
  const apply = useMutation({
    mutationFn: () => adminApi.applyPreset(selected),
    onSuccess: async (result) => {
      toast.success(`${PRESET_LABEL[result.preset]} 프리셋을 적용했습니다`)
      setChoice(null)
      setConfirming(false)
      await refresh()
    },
  })

  if (policy.isPending) return <Spinner />
  if (policy.isError) return <ErrorState error={policy.error} onRetry={() => policy.refetch()} />

  return (
    <Sheet>
      <SectionBar text="프리셋은 승인 기준표의 승인권자를 그대로 두고, 필요한 승인 인원만 바꿉니다.">
        <Button
          variant="primary"
          disabled={selected === policy.data.preset}
          disabledReason="지금 적용된 프리셋입니다"
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
            applied={preset === policy.data.preset}
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
        실행기 로컬 정책에도 배포됩니다. 앞으로 제출하는 요청부터 새 승인 인원을 적용합니다.
      </ConfirmModal>
    </Sheet>
  )
}

function MatrixSection() {
  const refresh = useRefreshAll()
  const [draft, setDraft] = useState<ApprovalMatrixRow[] | null>(null)
  const [confirming, setConfirming] = useState(false)
  const matrix = useQuery({ queryKey: ['approval-matrix'], queryFn: orgApi.approvalMatrix })
  const rows = draft ?? matrix.data
  const dirty = Boolean(draft) && JSON.stringify(draft) !== JSON.stringify(matrix.data)
  const save = useMutation({
    mutationFn: () => adminApi.updateMatrix(rows as ApprovalMatrixRow[]),
    onSuccess: async () => {
      toast.success('승인 기준표를 저장했습니다')
      setDraft(null)
      setConfirming(false)
      await refresh()
    },
  })

  const updateRow = (taskType: ApprovalMatrixRow['taskType'], patch: Partial<ApprovalMatrixRow>) => {
    setDraft((rows ?? []).map((row) => (row.taskType === taskType ? { ...row, ...patch } : row)))
  }

  /** 승인권자는 위험도로 정해진다: 높음은 담당자로 고정, 높음에서 내리면 누구나로 돌아간다 (5.2). */
  const changeRisk = (row: ApprovalMatrixRow, risk: ApprovalMatrixRow['defaultRisk']) => {
    if (risk === 'HIGH') updateRow(row.taskType, { defaultRisk: risk, approverRule: 'PROJECT_OWNER' })
    else if (row.defaultRisk === 'HIGH') updateRow(row.taskType, { defaultRisk: risk, approverRule: 'ANYONE' })
    else updateRow(row.taskType, { defaultRisk: risk })
  }

  const changed = (row: ApprovalMatrixRow) => {
    const saved = matrix.data?.find((item) => item.taskType === row.taskType)
    return Boolean(saved) && (saved?.defaultRisk !== row.defaultRisk || saved?.approverRule !== row.approverRule)
  }

  return (
    <Sheet flush>
      <div className="px-4 py-3">
        <SectionBar text="AI는 내용에 따라 위험도를 올리기만 할 수 있고, 기본값보다 내리지는 못합니다.">
          {dirty && <Button onClick={() => setDraft(null)}>되돌리기</Button>}
          <Button
            variant="primary"
            disabled={!dirty}
            disabledReason="바뀐 내용이 없습니다"
            onClick={() => setConfirming(true)}
          >
            기준표 저장
          </Button>
        </SectionBar>
      </div>
      {matrix.isPending && <Spinner />}
      {matrix.isError && <ErrorState error={matrix.error} onRetry={() => matrix.refetch()} />}
      {rows && (
        <div className="overflow-x-auto">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>작업 유형</th>
                <th>예시</th>
                <th>기본 위험도</th>
                <th>승인권자</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.taskType}>
                  <td className="font-medium whitespace-nowrap">
                    {row.label}
                    {changed(row) && <span className="ml-2 text-[0.875rem] font-medium text-seal">바뀜</span>}
                  </td>
                  <td className="text-ink-2">{row.examples}</td>
                  <td>
                    <div className="w-28">
                      <Select
                        aria-label={`${row.label} 기본 위험도`}
                        value={row.defaultRisk}
                        onChange={(event) => changeRisk(row, event.target.value as ApprovalMatrixRow['defaultRisk'])}
                      >
                        {EDITABLE_RISKS.map((risk) => (
                          <option key={risk} value={risk}>
                            {RISK_LABEL[risk as Risk]}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </td>
                  <td>
                    <div className="w-44">
                      <Select
                        aria-label={`${row.label} 승인권자`}
                        value={row.approverRule}
                        disabled={row.defaultRisk === 'HIGH'}
                        title={row.defaultRisk === 'HIGH' ? '위험도 높음은 프로젝트 담당자가 승인합니다' : undefined}
                        onChange={(event) => updateRow(row.taskType, { approverRule: event.target.value as ApproverRule })}
                      >
                        {EDITABLE_RULES.map((rule) => (
                          <option key={rule} value={rule}>
                            {RULE_LABEL[rule]}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </td>
                </tr>
              ))}
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
        실행기 로컬 정책에도 배포됩니다.
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
