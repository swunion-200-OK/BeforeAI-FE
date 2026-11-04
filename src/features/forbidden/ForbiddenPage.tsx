import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useMe } from '../../app/AuthProvider'
import { forbiddenApi, type ForbiddenInput } from '../../api/endpoints'
import type { ForbiddenProposal } from '../../api/types'
import { Banner, Button, ErrorState, Mono, PageHeader, Sheet, Spinner } from '../../components/ui'
import { TASK_TYPE_LABEL } from '../../lib/labels'
import { useDepartmentNames, useRefreshAll } from '../../lib/queries'
import { ForbiddenAdminPanel } from './ForbiddenAdminPanel'
import { EMPTY_FORBIDDEN_INPUT, ForbiddenFields, isForbiddenInputComplete } from './ForbiddenFields'
import { ForbiddenRuleTable } from './ForbiddenRuleTable'

function ManagerView({ departmentId }: { departmentId: string }) {
  const refresh = useRefreshAll()
  const departmentName = useDepartmentNames()
  const [input, setInput] = useState<ForbiddenInput>(EMPTY_FORBIDDEN_INPUT)
  // TODO(spec): 제안 내역 조회 API는 ADMIN 전용이라 팀장은 지금 보낸 제안의 결과만 볼 수 있다.
  const [submitted, setSubmitted] = useState<ForbiddenProposal | null>(null)
  const rules = useQuery({
    queryKey: ['forbidden-rules', departmentId],
    queryFn: async () => (await forbiddenApi.rules(departmentId)).items,
  })
  const propose = useMutation({
    mutationFn: () => forbiddenApi.propose(departmentId, input),
    onSuccess: async (proposal) => {
      setSubmitted(proposal)
      setInput(EMPTY_FORBIDDEN_INPUT)
      await refresh()
    },
  })

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Sheet title={`${departmentName(departmentId)} 확정 규칙`} flush>
        {rules.isPending && <Spinner />}
        {rules.isError && <ErrorState error={rules.error} onRetry={() => rules.refetch()} />}
        {rules.data && <ForbiddenRuleTable rules={rules.data} />}
      </Sheet>
      <div className="flex flex-col gap-4">
        <Sheet title="금지 작업 제안">
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              propose.mutate()
            }}
          >
            <ForbiddenFields value={input} onChange={setInput} />
            <Button
              type="submit"
              variant="primary"
              disabled={!isForbiddenInputComplete(input)}
              disabledReason="대상과 사유를 입력해 주세요"
              loading={propose.isPending}
            >
              제안 보내기
            </Button>
          </form>
        </Sheet>
        {submitted && (
          <Banner tone="info" title="제안을 보냈습니다">
            {TASK_TYPE_LABEL[submitted.taskType]}, <Mono>{submitted.target}</Mono>. 관리자가 확정하면 적용됩니다.
          </Banner>
        )}
      </div>
    </div>
  )
}

export default function ForbiddenPage() {
  const me = useMe()
  if (me.role === 'ADMIN') {
    return (
      <>
        <PageHeader
          title="금지 작업"
          description="팀장이 제안한 금지 작업을 확정하거나 반려합니다. 확정한 규칙은 Plan 단계와 실행 직전에 두 번 차단합니다."
        />
        <ForbiddenAdminPanel />
      </>
    )
  }
  return (
    <>
      <PageHeader
        title="금지 작업 제안"
        description="소속 부서에서 AI로 실행하면 안 되는 작업을 제안합니다. 관리자가 확정하면 Plan 단계와 실행 직전에 두 번 차단합니다."
      />
      {me.departmentId ? (
        <ManagerView departmentId={me.departmentId} />
      ) : (
        <Banner tone="warning">소속 부서가 없어 제안할 수 없습니다. 관리자에게 부서 지정을 요청해 주세요.</Banner>
      )}
    </>
  )
}
