import { useMutation, useQuery } from '@tanstack/react-query'
import { OctagonX } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { adminApi, requestsApi } from '../../api/endpoints'
import { toast } from '../../components/toast'
import { Banner, Button, EmptyState, ErrorState, Field, Modal, Sheet, Spinner, TextArea, TextInput } from '../../components/ui'
import { formatElapsed } from '../../lib/format'
import { useRefreshAll } from '../../lib/queries'

const CONFIRM_PHRASE = '일괄 중단'

function KillAllModal({ runningCount, onClose }: { runningCount: number; onClose: () => void }) {
  const refresh = useRefreshAll()
  const [reason, setReason] = useState('')
  const [phrase, setPhrase] = useState('')
  const killAll = useMutation({
    mutationFn: () => adminApi.killAll(reason.trim()),
    onSuccess: async (result) => {
      toast.success(`실행 중이던 요청 ${result.killedRequestIds.length}건을 중단했습니다`)
      await refresh()
      onClose()
    },
  })
  const ready = Boolean(reason.trim()) && phrase === CONFIRM_PHRASE
  return (
    <Modal
      open
      title="전사 일괄 중단"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button
            variant="danger"
            disabled={!ready}
            disabledReason={`사유를 적고 "${CONFIRM_PHRASE}"를 입력해 주세요`}
            loading={killAll.isPending}
            onClick={() => killAll.mutate()}
          >
            전체 실행 중단
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Banner tone="danger" title={`실행 중인 요청 ${runningCount}건을 모두 멈춥니다`}>
          남은 작업은 실행하지 않습니다. 이미 성공한 코드 작업은 되돌리지 않습니다.
        </Banner>
        <Field label="중단 사유">
          {(id) => <TextArea id={id} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} autoFocus />}
        </Field>
        <Field label={`확인을 위해 "${CONFIRM_PHRASE}"를 입력하세요`}>
          {(id) => <TextInput id={id} value={phrase} autoComplete="off" onChange={(event) => setPhrase(event.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}

/**
 * 전사 일괄 중단 (CORE-11).
 * TODO(spec): API(POST /admin/kill-all)는 외부망도 허용하지만, 이 버튼이 있는 설정 화면은 내부망 전용이라
 * 외부망에서 전사 중단을 누를 화면이 없다. 외부망 진입점을 둘지 명세 확인이 필요하다.
 */
export function KillAllTab() {
  const [confirming, setConfirming] = useState(false)
  const running = useQuery({
    queryKey: ['requests', 'running-all'],
    queryFn: async () => (await requestsApi.list({ status: 'RUNNING', limit: 100 })).items,
    refetchInterval: 3000,
  })
  const count = running.data?.length ?? 0

  return (
    <Sheet
      title={running.data ? `지금 실행 중인 요청 ${count}건` : '지금 실행 중인 요청'}
      flush
      actions={
        <Button
          variant="danger"
          disabled={count === 0}
          disabledReason="실행 중인 요청이 없습니다"
          onClick={() => setConfirming(true)}
        >
          <OctagonX size={15} aria-hidden />
          전사 일괄 중단
        </Button>
      }
    >
      {running.isPending && <Spinner />}
      {running.isError && <ErrorState error={running.error} onRetry={() => running.refetch()} />}
      {running.data?.length === 0 && <EmptyState title="실행 중인 요청이 없습니다" />}
      {running.data && running.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>요청</th>
                <th>요청자</th>
                <th>요청 후 경과</th>
              </tr>
            </thead>
            <tbody>
              {running.data.map((request) => (
                <tr key={request.id}>
                  <td>
                    <Link to={`/requests/${request.id}`} className="text-seal hover:underline">
                      {request.prompt}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{request.requester.name}</td>
                  <td className="whitespace-nowrap text-ink-2">{formatElapsed(request.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirming && <KillAllModal runningCount={count} onClose={() => setConfirming(false)} />}
    </Sheet>
  )
}
