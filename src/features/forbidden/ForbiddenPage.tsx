import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { useMe } from '../../app/AuthProvider'
import { forbiddenApi, type ForbiddenInput } from '../../api/endpoints'
import type { ForbiddenProposal } from '../../api/types'
import { Banner, Button, ErrorState, Modal, Mono, PageHeader, Sheet, Spinner } from '../../components/ui'
import { TASK_TYPE_LABEL } from '../../lib/labels'
import { useDepartmentNames, useRefreshAll } from '../../lib/queries'
import { ForbiddenAdminPanel } from './ForbiddenAdminPanel'
import { ForbiddenFields } from './ForbiddenFields'
import { EMPTY_FORBIDDEN_INPUT, isForbiddenInputComplete } from './forbiddenInput'
import { ForbiddenRuleTable } from './ForbiddenRuleTable'

const PAGE_DESCRIPTION = '관리자가 확정하면 Plan 단계와 실행 직전에 두 번 차단합니다.'

function ProposeModal({
  departmentId,
  onClose,
  onSubmitted,
}: {
  departmentId: string
  onClose: () => void
  onSubmitted: (proposal: ForbiddenProposal) => void
}) {
  const refresh = useRefreshAll()
  const formId = useId()
  const [input, setInput] = useState<ForbiddenInput>(EMPTY_FORBIDDEN_INPUT)
  const propose = useMutation({
    mutationFn: () => forbiddenApi.propose(departmentId, input),
    onSuccess: async (proposal) => {
      onSubmitted(proposal)
      onClose()
      await refresh()
    },
  })
  return (
    <Modal
      open
      title="금지 작업 제안"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={!isForbiddenInputComplete(input)}
            disabledReason="대상과 사유를 입력해 주세요"
            loading={propose.isPending}
          >
            제안 보내기
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (isForbiddenInputComplete(input)) propose.mutate()
        }}
      >
        <ForbiddenFields value={input} onChange={setInput} />
      </form>
    </Modal>
  )
}

function ManagerView({ departmentId }: { departmentId: string }) {
  const departmentName = useDepartmentNames()
  const [proposing, setProposing] = useState(false)
  // TODO(spec): 제안 내역 조회 API는 ADMIN 전용이라 팀장은 지금 보낸 제안의 결과만 볼 수 있다.
  const [submitted, setSubmitted] = useState<ForbiddenProposal | null>(null)
  const rules = useQuery({
    queryKey: ['forbidden-rules', departmentId],
    queryFn: async () => (await forbiddenApi.rules(departmentId)).items,
  })

  return (
    <>
      <PageHeader
        title="금지 작업 제안"
        description={PAGE_DESCRIPTION}
        actions={
          <Button variant="primary" onClick={() => setProposing(true)}>
            <Plus size={15} aria-hidden />
            제안하기
          </Button>
        }
      />
      {submitted && (
        <div className="mb-4">
          <Banner tone="info" title="제안을 보냈습니다">
            {TASK_TYPE_LABEL[submitted.taskType]}, <Mono>{submitted.target}</Mono>. 관리자가 확정하면 적용됩니다.
          </Banner>
        </div>
      )}
      <Sheet title={`${departmentName(departmentId)} 확정 규칙${rules.data ? ` ${rules.data.length}건` : ''}`} flush>
        {rules.isPending && <Spinner />}
        {rules.isError && <ErrorState error={rules.error} onRetry={() => rules.refetch()} />}
        {rules.data && <ForbiddenRuleTable rules={rules.data} />}
      </Sheet>
      {proposing && (
        <ProposeModal departmentId={departmentId} onClose={() => setProposing(false)} onSubmitted={setSubmitted} />
      )}
    </>
  )
}

export default function ForbiddenPage() {
  const me = useMe()
  if (me.role === 'ADMIN') {
    return (
      <>
        <PageHeader title="금지 작업" description="확정한 규칙은 Plan 단계와 실행 직전에 두 번 차단합니다." />
        <ForbiddenAdminPanel />
      </>
    )
  }
  if (!me.departmentId) {
    return (
      <>
        <PageHeader title="금지 작업 제안" description={PAGE_DESCRIPTION} />
        <Banner tone="warning">소속 부서가 없어 제안할 수 없습니다. 관리자에게 부서 지정을 요청해 주세요.</Banner>
      </>
    )
  }
  return <ManagerView departmentId={me.departmentId} />
}
