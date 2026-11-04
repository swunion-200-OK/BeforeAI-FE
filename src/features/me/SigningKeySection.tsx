import { useMutation, useQuery } from '@tanstack/react-query'
import { meApi } from '../../api/endpoints'
import type { Me, SigningKeyStatus } from '../../api/types'
import { toast } from '../../components/toast'
import { Banner, Button, ErrorState, Mono, Sheet, Spinner } from '../../components/ui'
import { deviceStore } from '../../crypto/deviceStore'
import { signingService } from '../../crypto/signingService'
import { formatDateTime } from '../../lib/format'
import { useRefreshAll } from '../../lib/queries'

const STATUS_LABEL: Record<SigningKeyStatus, string> = {
  PENDING: '관리자 등록 대기',
  REGISTERED: '등록됨',
  REVOKED: '폐기됨',
}

const STATUS_CLASS: Record<SigningKeyStatus, string> = {
  PENDING: 'bg-medium-soft text-medium',
  REGISTERED: 'bg-low-soft text-low',
  REVOKED: 'bg-forbidden-soft text-forbidden',
}

function shorten(key: string) {
  return key.length > 20 ? `${key.slice(0, 20)}…` : key
}

/** 승인 키 등록 (ADM-09): 기기에서 키 생성 → 실행기 공개키 고정 → 공개키 제출 → 관리자 등록 */
export function SigningKeySection({ me }: { me: Me }) {
  const refreshAll = useRefreshAll()
  const keys = useQuery({
    queryKey: ['me', 'signing-keys'],
    queryFn: async () => (await meApi.signingKeys()).items,
  })
  const device = deviceStore.get(me.id)
  const hasDeviceKey = signingService.hasDeviceKey(me.id)
  const deviceKeyStatus = keys.data?.find((key) => key.keyId === device.keyId)?.status
  const deviceKeyUsable = hasDeviceKey && (deviceKeyStatus === 'REGISTERED' || deviceKeyStatus === 'PENDING')

  const create = useMutation({
    mutationFn: async () => {
      // 실행기 공개키를 먼저 받아 둔다. 여기서 실패하면 기존 기기 키를 덮어쓰지 않는다.
      const { publicKey: executorKey } = await meApi.executorPublicKey()
      const { publicKey } = signingService.generateDeviceKey(me.id)
      deviceStore.update(me.id, { pinnedExecutorKey: executorKey })
      const key = await meApi.submitSigningKey(publicKey)
      deviceStore.update(me.id, { keyId: key.keyId })
      return key
    },
    onSuccess: async () => {
      toast.success('승인 키를 만들어 제출했습니다. 관리자 등록을 기다려 주세요')
      await refreshAll()
    },
  })

  return (
    <Sheet
      title="승인 키"
      actions={
        !deviceKeyUsable && (
          <Button variant="primary" internalOnly loading={create.isPending} onClick={() => create.mutate()}>
            이 기기에서 키 만들기
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {deviceKeyStatus === 'PENDING' && (
          <Banner tone="warning" title="관리자 등록을 기다리고 있습니다">
            관리자가 실행기에 공개키를 등록하면 승인할 수 있습니다.
          </Banner>
        )}
        {deviceKeyStatus === 'REGISTERED' && hasDeviceKey && (
          <Banner tone="info" title="이 기기에서 승인할 수 있습니다">
            승인 서명은 이 기기에 있는 개인키로 만듭니다. 개인키는 기기 밖으로 나가지 않습니다.
          </Banner>
        )}
        {!deviceKeyUsable && !keys.isPending && (
          <Banner tone="warning" title="승인 키 등록 필요">
            이 기기에서 키를 만들어 제출하고 관리자 등록을 받으면 승인할 수 있습니다.
          </Banner>
        )}

        {device.pinnedExecutorKey && (
          <p className="text-[0.8125rem] text-ink-2">
            고정한 실행기 공개키 <Mono>{shorten(device.pinnedExecutorKey)}</Mono>
          </p>
        )}

        {keys.isPending && <Spinner />}
        {keys.isError && <ErrorState error={keys.error} onRetry={() => keys.refetch()} />}
        {keys.data && keys.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>키</th>
                  <th>공개키</th>
                  <th>상태</th>
                  <th>제출</th>
                  <th>등록</th>
                </tr>
              </thead>
              <tbody>
                {keys.data.map((key) => (
                  <tr key={key.keyId}>
                    <td className="whitespace-nowrap">
                      <Mono>{key.keyId}</Mono>
                      {key.keyId === device.keyId && <span className="ml-1.5 text-xs text-ink-3">이 기기</span>}
                    </td>
                    <td title={key.publicKey}>
                      <Mono>{shorten(key.publicKey)}</Mono>
                    </td>
                    <td>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_CLASS[key.status]}`}>
                        {STATUS_LABEL[key.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">{formatDateTime(key.createdAt)}</td>
                    <td className="whitespace-nowrap">{key.registeredAt ? formatDateTime(key.registeredAt) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Sheet>
  )
}
