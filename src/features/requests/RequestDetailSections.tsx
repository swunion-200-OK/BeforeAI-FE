import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { RequestDetail, RequestStatus, TaskApprovalStatus } from '../../api/types'
import { ApprovalStamps, approvalSummary } from '../../components/ApprovalStamps'
import { LogViewer } from '../../components/LogViewer'
import { KeyValues, Timeline } from '../../components/rich'
import { Mono } from '../../components/ui'
import { formatDateTime, shortHash } from '../../lib/format'
import { REQUEST_STATUS_LABEL, SOURCE_LABEL } from '../../lib/labels'
import { approvalToShow } from './requestPaths'

const IN_PROGRESS: RequestStatus[] = [
  'ANALYZING',
  'REVIEWING',
  'PENDING_APPROVAL',
  'REAPPROVAL_REQUIRED',
  'RUNNING',
  'ROLLING_BACK',
]
const ERROR_END: RequestStatus[] = [
  'ANALYSIS_FAILED',
  'VERIFICATION_FAILED',
  'REJECTED',
  'KILLED',
  'FAILED',
  'ROLLBACK_FAILED',
]

const FOLD_LABEL =
  'inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden'

/** 작업 카드 아래 한 줄: 작은 도장과 승인 현황. 결재란 전체는 맨 아래 "자세히"에 있다. */
export function TaskApprovalLine({ status }: { status: TaskApprovalStatus }) {
  const signer = status.requirements.flatMap((requirement) => requirement.approvedBy)[0]
  return (
    <p className="flex items-center gap-2.5 text-sm text-ink-2">
      {signer ? (
        <span className="inline-flex size-9 shrink-0 -rotate-6 items-center justify-center rounded-full border-2 border-seal text-[0.65rem] leading-none font-bold tracking-tight text-seal">
          {signer.name}
        </span>
      ) : (
        <span aria-hidden className="size-9 shrink-0 rounded-full border-2 border-dashed border-rule-strong" />
      )}
      {approvalSummary(status)}
    </p>
  )
}

/** 실행 로그. 실행 중이면 펼쳐 두고, 끝난 요청은 눌렀을 때만 불러온다. 보던 중에 끝나도 접지 않는다. */
export function RunLog({ requestId, live }: { requestId: string; live: boolean }) {
  const [open, setOpen] = useState(live)
  return (
    <section aria-label="실행 로그" className="flex flex-col items-start gap-2 [&>div]:w-full">
      {!live && (
        <button type="button" aria-expanded={open} className={FOLD_LABEL} onClick={() => setOpen(!open)}>
          {open ? '실행 로그 접기' : '실행 로그 보기'}
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      )}
      {(open || live) && <LogViewer requestId={requestId} live={live} />}
    </section>
  )
}

function Part({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? 'col-span-2' : ''}>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

/** 맨 아래에 접어 두는 기록: Plan 정보, 결재란, 진행 기록 */
export function MoreDetails({ request }: { request: RequestDetail }) {
  const { plan, events } = request
  const last = events.length - 1
  const stamps = (plan?.tasks ?? []).flatMap((task) => {
    const status = approvalToShow(request, task)
    return status ? [{ task, status }] : []
  })
  return (
    <details className="group">
      <summary className={FOLD_LABEL}>
        자세히
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-x-10 gap-y-6 rounded-xl border border-rule bg-sheet p-5">
        {plan && (
          <Part title="Plan 정보">
            <KeyValues
              items={[
                { label: 'Plan 해시', value: <Mono>{plan.planHash ? shortHash(plan.planHash) : '제출 후 만들어집니다'}</Mono> },
                { label: '기준 커밋', value: <Mono>{plan.baseCommit}</Mono> },
                { label: '저장소', value: <Mono>{plan.repository}</Mono> },
                { label: '출처', value: SOURCE_LABEL[request.source] },
              ]}
            />
          </Part>
        )}
        <Part title="진행 기록">
          <Timeline
            items={events.map((event, index) => ({
              key: `${event.status}-${event.at}`,
              title: REQUEST_STATUS_LABEL[event.status],
              meta: `${event.by ? `${event.by}, ` : ''}${formatDateTime(event.at)}`,
              tone:
                index < last
                  ? 'done'
                  : ERROR_END.includes(event.status)
                    ? 'error'
                    : IN_PROGRESS.includes(event.status)
                      ? 'current'
                      : 'done',
            }))}
          />
        </Part>
        {stamps.length > 0 && (
          <Part title="결재 현황" wide>
            <ul className="flex flex-wrap gap-x-6 gap-y-4">
              {stamps.map(({ task, status }) => (
                <li key={task.id}>
                  <p className="mb-1.5 text-sm font-medium">
                    <span className="mr-1.5 font-mono text-xs text-ink-3">{task.id}</span>
                    {task.title}
                  </p>
                  <ApprovalStamps status={status} />
                </li>
              ))}
            </ul>
          </Part>
        )}
      </div>
    </details>
  )
}
