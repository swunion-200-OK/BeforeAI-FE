import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { adminApi } from '../../api/endpoints'
import { toast } from '../../components/toast'
import { Banner, Button, Field, Modal, TextArea, TextInput } from '../../components/ui'
import { formatElapsed } from '../../lib/format'
import { useRefreshAll } from '../../lib/queries'
import { runningRequestsQuery } from './adminQueries'

const CONFIRM_PHRASE = '일괄 중단'

/**
 * 전사 일괄 중단의 강한 확인 창 (CORE-11).
 * 사유와 확인 문구를 모두 넣어야 실행된다. API가 외부망도 허용하므로 대시보드에서도 연다.
 */
export function KillAllDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const refresh = useRefreshAll()
  const [reason, setReason] = useState('')
  const [phrase, setPhrase] = useState('')
  const running = useQuery({ ...runningRequestsQuery, enabled: open, refetchInterval: open ? 3000 : false })
  const items = running.data ?? []

  const close = () => {
    setReason('')
    setPhrase('')
    onClose()
  }

  const killAll = useMutation({
    mutationFn: () => adminApi.killAll(reason.trim()),
    onSuccess: async (result) => {
      toast.success(`실행 중이던 요청 ${result.killedRequestIds.length}건을 중단했습니다`)
      await refresh()
      close()
    },
  })

  const blockedReason =
    items.length === 0
      ? '실행 중인 요청이 없습니다'
      : !reason.trim() || phrase !== CONFIRM_PHRASE
        ? `사유를 적고 "${CONFIRM_PHRASE}"를 입력해 주세요`
        : null

  return (
    <Modal
      open={open}
      title="전사 일괄 중단"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>닫기</Button>
          <Button
            variant="danger"
            disabled={Boolean(blockedReason)}
            disabledReason={blockedReason}
            loading={killAll.isPending}
            onClick={() => killAll.mutate()}
          >
            전체 실행 중단
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Banner tone="danger" title={`실행 중인 요청 ${items.length}건을 모두 멈춥니다`}>
          서명 없이 바로 멈추고 남은 작업은 실행하지 않습니다. 이미 성공한 코드 작업은 되돌리지 않습니다.
        </Banner>
        {items.length > 0 && (
          <ul className="quiet-scroll max-h-36 divide-y divide-rule overflow-y-auto rounded-lg border border-rule text-sm">
            {items.map((request) => (
              <li key={request.id} className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
                <span className="min-w-0 truncate text-ink">{request.prompt}</span>
                <span className="shrink-0 text-xs whitespace-nowrap text-ink-3">
                  {request.requester.name}, {formatElapsed(request.createdAt)} 전
                </span>
              </li>
            ))}
          </ul>
        )}
        <Field label="중단 사유" hint="누가 왜 멈췄는지 감사 로그에 남습니다">
          {(id) => <TextArea id={id} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />}
        </Field>
        <Field label={`확인을 위해 "${CONFIRM_PHRASE}"를 입력하세요`}>
          {(id) => <TextInput id={id} value={phrase} autoComplete="off" onChange={(event) => setPhrase(event.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}
