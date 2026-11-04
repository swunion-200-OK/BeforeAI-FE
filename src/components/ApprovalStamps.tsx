import type { RequirementStatus, TaskApprovalStatus } from '../api/types'
import { formatDateTime } from '../lib/format'
import { NETWORK_LABEL, RULE_LABEL } from '../lib/labels'

/**
 * 결재란. 이 앱을 대표하는 요소다.
 * 승인 규칙마다 칸을 하나 두고, 서명이 모이면 군청 인주 도장이 찍힌다.
 */
function Seal({ name, animate }: { name: string; animate?: boolean }) {
  return (
    <span
      className={`inline-flex size-14 -rotate-6 items-center justify-center rounded-full border-2 border-seal text-seal outline-1 outline-offset-2 outline-seal/60 ${
        animate ? 'animate-stamp' : ''
      }`}
    >
      <span className="text-[0.8125rem] leading-tight font-bold tracking-tight">{name}</span>
    </span>
  )
}

function EmptySeal() {
  return <span className="inline-flex size-14 rounded-full border-2 border-dashed border-rule-strong" aria-hidden />
}

function candidatesText(requirement: RequirementStatus): string {
  if (requirement.candidates.length === 0) return RULE_LABEL[requirement.rule]
  const names = requirement.candidates.map((c) => c.name).join(', ')
  return requirement.candidates.length > requirement.count ? `${names} 중 ${requirement.count}명` : names
}

/** 작업 한 건의 승인 현황을 사람이 읽는 문장으로 만든다. 예: "담당자 승인 대기 · 김담당, 이담당 중 1명" */
export function approvalSummary(status: TaskApprovalStatus): string {
  const waiting = status.requirements.filter((r) => !r.satisfied)
  if (waiting.length === 0) {
    const self = status.requirements.every((r) => r.approvedBy.every((a) => a.self))
    return self ? '본인 승인 완료' : '승인 완료'
  }
  return waiting.map((r) => `${RULE_LABEL[r.rule]} 승인 대기 · ${candidatesText(r)}`).join(' / ')
}

export function ApprovalStamps({
  status,
  justStampedBy,
}: {
  status: TaskApprovalStatus
  /** 방금 서명한 사람의 도장에만 찍히는 움직임을 준다 */
  justStampedBy?: string
}) {
  return (
    <div className="flex w-fit overflow-hidden rounded border border-rule-strong">
      {status.requirements.map((requirement, index) => {
        const record = requirement.approvedBy[0]
        return (
          <div
            key={`${requirement.rule}-${index}`}
            className="flex w-28 flex-col border-r border-rule-strong last:border-r-0"
          >
            <div className="border-b border-rule-strong bg-sheet-alt px-1.5 py-1 text-center text-2xs font-medium text-ink-2">
              {RULE_LABEL[requirement.rule]}
            </div>
            <div className="flex flex-1 flex-col items-center gap-1 px-1.5 py-2 text-center">
              {record ? (
                <Seal name={record.name} animate={justStampedBy === record.userId} />
              ) : (
                <EmptySeal />
              )}
              <p className="text-2xs leading-tight text-ink-3">
                {record ? (
                  <>
                    {record.self ? '본인 승인' : formatDateTime(record.at)}
                    <br />
                    {NETWORK_LABEL[record.network]}
                  </>
                ) : (
                  <>
                    대기
                    <br />
                    {candidatesText(requirement)}
                  </>
                )}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
