import { CircleCheck, Hourglass, Lock, Send } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMe } from '../../app/AuthProvider'
import type { RequestDetail, Risk, Task } from '../../api/types'
import { AvatarStack, RiskSummary } from '../../components/rich'
import { Banner, Button, Sheet } from '../../components/ui'
import { RULE_LABEL } from '../../lib/labels'
import { CancelRequestButton } from './RequestParts'
import { useSubmitRequest } from './useRequestActions'

/**
 * 제출과 함께 본인 승인될 작업을 미리 보여 준다. 실제 목록은 제출 응답의 selfApprovableTaskIds가 정한다.
 * 문서 작업은 완성본을 보고 적용 여부를 정해야 하므로 자동 승인에서 뺀다 (기능 명세서 5.4).
 */
function isSelfApprovable(task: Task) {
  const { rule, additional } = task.requiredApprovers
  return (
    task.type !== 'DOC' && (task.risk === 'LOW' || task.risk === 'MEDIUM') && rule === 'ANYONE' && !additional?.length
  )
}

function Group({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
        {icon}
        {title}
      </h3>
      <ul className="mt-1.5 flex flex-col gap-2">{children}</ul>
    </section>
  )
}

function TaskLine({ task, children }: { task: Task; children?: ReactNode }) {
  return (
    <li className="rounded-lg bg-sheet-alt px-2.5 py-1.5 text-[0.8125rem]">
      <p className="font-medium text-ink">
        <span className="mr-1.5 font-mono text-xs text-ink-3">{task.id}</span>
        {task.title}
      </p>
      {children}
    </li>
  )
}

function WhoApproves({ request, task }: { request: RequestDetail; task: Task }) {
  if (task.type === 'DOC') {
    return <p className="mt-0.5 text-xs text-ink-2">완성본을 보고 누구나 적용 또는 미적용을 정합니다</p>
  }
  const requirements = request.approvalStatus.find((status) => status.taskId === task.id)?.requirements ?? []
  return (
    <>
      {requirements.map((requirement) => {
        const names = requirement.candidates.map((candidate) => candidate.name)
        return (
          <p key={requirement.rule} className="mt-1 flex items-center gap-1.5 text-xs text-ink-2">
            {names.length > 0 && <AvatarStack names={names} max={3} />}
            <span>
              {RULE_LABEL[requirement.rule]}
              {names.length > 0 && `: ${names.join(', ')}`}
              {names.length > requirement.count && ` 중 ${requirement.count}명`}
            </span>
          </p>
        )
      })}
    </>
  )
}

/** Plan 검토 오른쪽 패널: 제출 버튼을 누르면 작업별로 어떻게 되는지 미리 보여 준다. */
export function SubmitPanel({ request }: { request: RequestDetail }) {
  const me = useMe()
  const navigate = useNavigate()
  const submit = useSubmitRequest(request.id, () => navigate(`/requests/${request.id}`))
  const tasks = request.plan?.tasks ?? []
  const forbidden = tasks.filter((task) => task.status === 'BLOCKED')
  const runnable = tasks.filter((task) => task.status !== 'BLOCKED')
  const self = runnable.filter(isSelfApprovable)
  const others = runnable.filter((task) => !isSelfApprovable(task))
  const cannotSubmit = runnable.length === 0
  const reason =
    tasks.length === 0
      ? '남은 작업이 없습니다. 요청을 취소하거나 새로 요청해 주세요'
      : '금지 작업만 남아 있어 제출할 수 없습니다. 요청을 취소해 주세요'

  const risks: Record<Risk, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, FORBIDDEN: 0 }
  for (const task of tasks) risks[task.risk] += 1

  return (
    <aside aria-label="제출 안내" className="sticky top-4 flex flex-col gap-3">
      <Sheet title="제출하면 어떻게 되나요" icon={<Send size={15} aria-hidden />}>
        <div className="flex flex-col gap-3.5">
          <p className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
            <span className="font-semibold">작업 {tasks.length}개</span>
            <RiskSummary risks={risks} />
          </p>

          {self.length > 0 && (
            <Group icon={<CircleCheck size={15} className="text-low" aria-hidden />} title="제출과 함께 본인 승인">
              {self.map((task) => (
                <TaskLine key={task.id} task={task} />
              ))}
            </Group>
          )}
          {others.length > 0 && (
            <Group icon={<Hourglass size={14} className="text-seal" aria-hidden />} title="승인을 더 받아야 함">
              {others.map((task) => (
                <TaskLine key={task.id} task={task}>
                  <WhoApproves request={request} task={task} />
                </TaskLine>
              ))}
            </Group>
          )}
          {forbidden.length > 0 && (
            <Group icon={<Lock size={14} className="text-forbidden" aria-hidden />} title="금지 작업은 실행되지 않음">
              {forbidden.map((task) => (
                <TaskLine key={task.id} task={task} />
              ))}
            </Group>
          )}

          {self.length > 0 && me.signingKeyStatus !== 'REGISTERED' && (
            <Banner tone="warning">
              승인 키가 등록되지 않아 본인 승인은 되지 않습니다. 제출은 할 수 있습니다.{' '}
              <Link to="/me" className="font-medium underline">
                승인 키 등록
              </Link>
            </Banner>
          )}
          {cannotSubmit && <Banner tone="warning">{reason}</Banner>}

          <div className="flex flex-col gap-2 border-t border-rule pt-3 [&>*]:w-full">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              loading={submit.isPending}
              disabled={cannotSubmit}
              disabledReason={reason}
              onClick={() => submit.mutate()}
            >
              제출
            </Button>
            <CancelRequestButton requestId={request.id} fullWidth onDone={() => navigate('/requests')} />
          </div>
          <p className="text-xs text-ink-3">
            제출은 Plan을 확인했다는 1차 확인입니다. 실행하려면 승인권자의 승인 서명이 있어야 합니다. 본인 승인이 허용된
            작업은 제출과 함께 승인됩니다.
          </p>
        </div>
      </Sheet>
    </aside>
  )
}
