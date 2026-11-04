import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { adminApi, orgApi } from '../../api/endpoints'
import type { ApprovalMatrixRow, ApproverRule, PolicyPreset, Risk } from '../../api/types'
import { RiskBadge } from '../../components/badges'
import { toast } from '../../components/toast'
import { Banner, Button, ConfirmModal, ErrorState, Select, Sheet, Spinner } from '../../components/ui'
import { PRESET_LABEL, RISK_LABEL, RULE_LABEL } from '../../lib/labels'
import { useRefreshAll } from '../../lib/queries'

const PRESETS: PolicyPreset[] = ['SMALL', 'MEDIUM', 'LARGE']

/** 기능 명세서 5.5 규모별 기본 정책 */
const PRESET_ROWS: Array<{ label: string; values: Record<PolicyPreset, string> }> = [
  {
    label: '위험도 낮음·중간 작업 승인',
    values: { SMALL: '요청자 본인', MEDIUM: '요청자 본인', LARGE: '요청자 외 같은 부서 1인' },
  },
  {
    label: '위험도 높음 작업 승인',
    values: { SMALL: '담당자 1인', MEDIUM: '담당자 + 부서 관리자', LARGE: '담당자 + 부서 관리자 + 관리자' },
  },
  { label: 'Slack 알림', values: { SMALL: '선택', MEDIUM: '기본 켜짐', LARGE: '기본 켜짐' } },
  { label: '감사 로그 보관', values: { SMALL: '90일', MEDIUM: '1년', LARGE: '3년' } },
]

const EDITABLE_RISKS: Array<ApprovalMatrixRow['defaultRisk']> = ['LOW', 'MEDIUM', 'HIGH']
const EDITABLE_RULES: ApproverRule[] = ['ANYONE', 'PROJECT_OWNER']

function PresetSection() {
  const refresh = useRefreshAll()
  const [choice, setChoice] = useState<PolicyPreset | null>(null)
  const [confirming, setConfirming] = useState(false)
  const policy = useQuery({ queryKey: ['admin', 'policy'], queryFn: adminApi.policy })
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

  if (policy.isPending) return <Sheet title="규모별 기본 정책"><Spinner /></Sheet>
  if (policy.isError) {
    return (
      <Sheet title="규모별 기본 정책">
        <ErrorState error={policy.error} onRetry={() => policy.refetch()} />
      </Sheet>
    )
  }

  return (
    <Sheet
      title="규모별 기본 정책"
      flush
      actions={
        <Button
          variant="primary"
          disabled={selected === policy.data.preset}
          disabledReason="지금 적용된 프리셋입니다"
          onClick={() => setConfirming(true)}
        >
          프리셋 적용
        </Button>
      }
    >
      <p className="px-4 pt-3 text-sm text-ink-2">
        프리셋은 승인 기준표의 승인권자를 그대로 두고, 필요한 승인 인원만 바꿉니다.
      </p>
      <div className="overflow-x-auto">
        <table className="sheet-table">
          <thead>
            <tr>
              <th>항목</th>
              {PRESETS.map((preset) => (
                <th key={preset} className={preset === selected ? 'bg-seal-soft' : ''}>
                  <label className="flex items-center gap-1.5 font-medium text-ink">
                    <input
                      type="radio"
                      name="preset"
                      className="accent-seal"
                      checked={preset === selected}
                      onChange={() => setChoice(preset)}
                    />
                    {PRESET_LABEL[preset]}
                    {preset === policy.data.preset && <span className="text-xs font-normal text-ink-3">(적용 중)</span>}
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRESET_ROWS.map((row) => (
              <tr key={row.label}>
                <td className="text-ink-2">{row.label}</td>
                {PRESETS.map((preset) => (
                  <td key={preset} className={preset === selected ? 'bg-seal-soft/50' : ''}>
                    {row.values[preset]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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

  return (
    <Sheet
      title="승인 기준표"
      flush
      actions={
        <>
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
      <div className="px-4 pt-3">
        <Banner tone="neutral">
          여기서 정한 위험도는 기본값입니다. AI는 내용에 따라 위험도를 올리기만 할 수 있고, 기본값보다 내리지는 못합니다.
        </Banner>
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
                  <td className="font-medium whitespace-nowrap">{row.label}</td>
                  <td className="text-ink-2">{row.examples}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Select
                        aria-label={`${row.label} 기본 위험도`}
                        className="w-24"
                        value={row.defaultRisk}
                        onChange={(event) => changeRisk(row, event.target.value as ApprovalMatrixRow['defaultRisk'])}
                      >
                        {EDITABLE_RISKS.map((risk) => (
                          <option key={risk} value={risk}>
                            {RISK_LABEL[risk as Risk]}
                          </option>
                        ))}
                      </Select>
                      <RiskBadge risk={row.defaultRisk} />
                    </div>
                  </td>
                  <td>
                    <Select
                      aria-label={`${row.label} 승인권자`}
                      className="w-40"
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
