import { Link, useNavigate } from 'react-router'
import { useMe } from '../../app/AuthProvider'
import type { RequestDetail, Task, TaskApprovalStatus } from '../../api/types'
import { approversText } from '../../components/TaskCard'
import { Button } from '../../components/ui'
import { useApprovalStatuses } from '../../lib/approvalStatus'
import { RULE_LABEL } from '../../lib/labels'
import { tasksTopic } from '../../lib/taskLabel'
import { isSelfApprovable } from '../approvals/approvalFlow'
import { CancelRequestButton } from './RequestParts'
import { useSubmitRequest } from './useRequestActions'

function whoApproves(statuses: TaskApprovalStatus[], task: Task) {
  const requirements = statuses.find((status) => status.taskId === task.id)?.requirements ?? []
  if (requirements.length === 0) return approversText(task.requiredApprovers)
  return requirements
    .map((requirement) => {
      const names = requirement.candidates.map((candidate) => candidate.name)
      if (names.length === 0) return RULE_LABEL[requirement.rule]
      return names.length > requirement.count ? `${names.join(', ')} 중 ${requirement.count}명` : names.join(', ')
    })
    .join(' + ')
}

/** 제출 버튼을 누르면 작업별로 어떻게 되는지 한 문장으로 쓴다. 제출과 승인이 다르다는 점이 여기서 드러난다. */
function describeSubmit(statuses: TaskApprovalStatus[], self: Task[], others: Task[], forbidden: Task[]) {
  const all = [...self, ...others, ...forbidden]
  const topic = (tasks: Task[]) => tasksTopic(tasks, all)
  const byApprover = new Map<string, Task[]>()
  for (const task of others.filter((item) => item.type !== 'DOC')) {
    const who = whoApproves(statuses, task)
    byApprover.set(who, [...(byApprover.get(who) ?? []), task])
  }
  const waits = [...byApprover].map(([who, tasks]) => `${topic(tasks)} ${who}의 승인을`).join(', ')
  const documents = others.filter((item) => item.type === 'DOC')

  const sentences: string[] = []
  if (self.length > 0 && waits) sentences.push(`${topic(self)} 제출과 함께 본인 승인되고, ${waits} 기다립니다.`)
  else if (self.length > 0) sentences.push(`${topic(self)} 제출과 함께 본인 승인됩니다.`)
  else if (waits) sentences.push(`제출하면 ${waits} 기다립니다.`)
  if (documents.length > 0) sentences.push(`${topic(documents)} 완성본을 보고 누구나 적용 여부를 정합니다.`)
  if (forbidden.length > 0) sentences.push(`${topic(forbidden)} 금지 작업이라 실행되지 않습니다.`)
  return sentences.join(' ')
}

/** Plan 검토 화면 아래에 붙는 막대. 제출하면 어떻게 되는지 한 문장과 버튼 둘. */
export function SubmitBar({ request }: { request: RequestDetail }) {
  const me = useMe()
  const navigate = useNavigate()
  const submit = useSubmitRequest(request, () => navigate(`/requests/${request.id}`))
  const statuses = useApprovalStatuses(request)
  const tasks = request.currentPlan?.tasks ?? []
  const isForbidden = (task: Task) => task.risk === 'FORBIDDEN' || task.status === 'BLOCKED'
  const forbidden = tasks.filter(isForbidden)
  const runnable = tasks.filter((task) => !isForbidden(task))
  const self = runnable.filter(isSelfApprovable)
  const others = runnable.filter((task) => !isSelfApprovable(task))
  const cannotSubmit = runnable.length === 0
  const reason =
    tasks.length === 0
      ? '남은 작업이 없습니다. 요청을 취소하거나 새로 요청해 주세요'
      : '금지 작업만 남아 있어 제출할 수 없습니다. 요청을 취소해 주세요'
  const keyMissing = self.length > 0 && !me.hasRegisteredSigningKey

  return (
    <aside
      aria-label="제출 안내"
      className="sticky bottom-0 z-10 mt-4 flex items-center justify-between gap-6 border-t border-rule-strong bg-sheet py-4"
    >
      {keyMissing ? (
        <p className="min-w-0 text-sm text-medium">
          승인 키가 등록되지 않아 본인 승인은 되지 않습니다. 제출은 할 수 있습니다.{' '}
          <Link to="/me" className="font-medium underline">
            승인 키 등록
          </Link>
        </p>
      ) : (
        <p className="min-w-0 text-sm text-ink">{cannotSubmit ? reason : describeSubmit(statuses, self, others, forbidden)}</p>
      )}
      <div className="flex shrink-0 items-center gap-2">
        <CancelRequestButton requestId={request.id} size="lg" onDone={() => navigate('/requests')} />
        <Button
          variant="primary"
          size="lg"
          loading={submit.isPending}
          disabled={cannotSubmit}
          disabledReason={reason}
          onClick={() => submit.mutate()}
        >
          제출
        </Button>
      </div>
    </aside>
  )
}
