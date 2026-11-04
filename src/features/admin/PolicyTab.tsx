import { useMutation, useQuery } from '@tanstack/react-query'
import { Scale, Sparkles, TableProperties } from 'lucide-react'
import { useState } from 'react'
import { adminApi, orgApi } from '../../api/endpoints'
import type { ApprovalMatrixRow, ApproverRule, PolicyPreset, Risk } from '../../api/types'
import { RiskBadge } from '../../components/badges'
import { toast } from '../../components/toast'
import { Button, ConfirmModal, ErrorState, Select, Sheet, Spinner } from '../../components/ui'
import { PRESET_LABEL, RISK_LABEL, RULE_LABEL } from '../../lib/labels'
import { useRefreshAll } from '../../lib/queries'
import { policyQuery } from './adminQueries'

const PRESETS: PolicyPreset[] = ['SMALL', 'MEDIUM', 'LARGE']

/** 기능 명세서 5.5 규모별 기본 정책. 도장 수는 높음 작업에 필요한 승인 인원이다. */
const PRESET_DETAILS: Record<
  PolicyPreset,
  { lowApprover: string; lowStamps: number; highApprover: string; highStamps: number; slack: string; audit: string }
> = {
  SMALL: { lowApprover: '요청자 본인', lowStamps: 1, highApprover: '담당자 1인', highStamps: 1, slack: '선택', audit: '90일' },
  MEDIUM: {
    lowApprover: '요청자 본인',
    lowStamps: 1,
    highApprover: '담당자 + 부서 관리자',
    highStamps: 2,
    slack: '기본 켜짐',
    audit: '1년',
  },
  LARGE: {
    lowApprover: '요청자 외 같은 부서 1인',
    lowStamps: 1,
    highApprover: '담당자 + 부서 관리자 + 관리자',
    highStamps: 3,
    slack: '기본 켜짐',
    audit: '3년',
  },
}

const EDITABLE_RISKS: Array<ApprovalMatrixRow['defaultRisk']> = ['LOW', 'MEDIUM', 'HIGH']
const EDITABLE_RULES: ApproverRule[] = ['ANYONE', 'PROJECT_OWNER']

/** 필요한 승인 인원을 빈 도장 칸으로 보여 준다. 글자로 같은 내용을 함께 쓰므로 스크린 리더에는 숨긴다. */
function Stamps({ count }: { count: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 gap-0.5">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="size-3.5 rounded-full border-[1.5px] border-seal" />
      ))}
    </span>
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
      className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors ${
        selected ? 'border-seal bg-seal-soft/40 ring-1 ring-seal' : 'border-rule hover:border-rule-strong hover:bg-sheet-alt'
      }`}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name="preset"
          aria-label={PRESET_LABEL[preset]}
          className="accent-seal"
          checked={selected}
          onChange={onSelect}
        />
        <span className="font-semibold text-ink">{PRESET_LABEL[preset]}</span>
        {applied && <span className="ml-auto rounded bg-seal px-1.5 py-0.5 text-xs font-medium text-white">적용 중</span>}
        {selected && !applied && (
          <span className="ml-auto rounded bg-medium-soft px-1.5 py-0.5 text-xs font-medium text-medium">적용 전</span>
        )}
      </span>
      <dl className="grid gap-y-1.5 text-[0.8125rem]">
        <div>
          <dt className="text-xs text-ink-3">위험도 낮음·중간 작업 승인</dt>
          <dd className="flex items-center justify-between gap-2 text-ink">
            {detail.lowApprover}
            <Stamps count={detail.lowStamps} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">위험도 높음 작업 승인</dt>
          <dd className="flex items-center justify-between gap-2 text-ink">
            {detail.highApprover}
            <Stamps count={detail.highStamps} />
          </dd>
        </div>
        <div className="flex gap-4">
          <div>
            <dt className="text-xs text-ink-3">Slack 알림</dt>
            <dd className="text-ink">{detail.slack}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">감사 로그 보관</dt>
            <dd className="text-ink">{detail.audit}</dd>
          </div>
        </div>
      </dl>
    </label>
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

  const icon = <Scale size={16} aria-hidden />
  if (policy.isPending) {
    return (
      <Sheet title="규모별 기본 정책" icon={icon}>
        <Spinner />
      </Sheet>
    )
  }
  if (policy.isError) {
    return (
      <Sheet title="규모별 기본 정책" icon={icon}>
        <ErrorState error={policy.error} onRetry={() => policy.refetch()} />
      </Sheet>
    )
  }

  return (
    <Sheet
      title="규모별 기본 정책"
      icon={icon}
      actions={
        <>
          <span className="text-xs text-ink-3">
            프리셋은 승인 기준표의 승인권자를 그대로 두고, 필요한 승인 인원만 바꿉니다.
          </span>
          <Button
            variant="primary"
            disabled={selected === policy.data.preset}
            disabledReason="지금 적용된 프리셋입니다"
            onClick={() => setConfirming(true)}
          >
            프리셋 적용
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
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
    <Sheet
      title="승인 기준표"
      icon={<TableProperties size={16} aria-hidden />}
      flush
      actions={
        <>
          <span className="inline-flex items-center gap-1.5 text-xs text-ai-dark">
            <Sparkles size={13} aria-hidden />
            AI는 내용에 따라 위험도를 올리기만 할 수 있고, 기본값보다 내리지는 못합니다.
          </span>
          <Button disabled={!dirty} onClick={() => setDraft(null)}>
            되돌리기
          </Button>
          <Button
            variant="primary"
            disabled={!dirty}
            disabledReason="바뀐 내용이 없습니다"
            onClick={() => setConfirming(true)}
          >
            기준표 저장
          </Button>
        </>
      }
    >
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
                <tr key={row.taskType} className={changed(row) ? 'bg-seal-soft/40' : ''}>
                  <td className="font-medium whitespace-nowrap">
                    {row.label}
                    {changed(row) && (
                      <span className="ml-2 rounded bg-seal-soft px-1.5 py-0.5 text-xs font-medium text-seal-dark">바뀜</span>
                    )}
                  </td>
                  <td className="text-ink-2">{row.examples}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-24 shrink-0">
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
                      <RiskBadge risk={row.defaultRisk} />
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
              <tr className="bg-forbidden-soft/50">
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

export function PolicyTab() {
  return (
    <div className="flex flex-col gap-4">
      <PresetSection />
      <MatrixSection />
    </div>
  )
}
