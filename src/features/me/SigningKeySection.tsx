import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { meApi } from '../../api/endpoints'
import { errorMessage } from '../../api/errors'
import type { Me, SigningKeyStatus } from '../../api/types'
import { Stepper, type Step } from '../../components/RequestStepper'
import { toast } from '../../components/toast'
import { Banner, Button, ErrorState, Mono, Sheet, Spinner } from '../../components/ui'
import { cryptoService } from '../../crypto/cryptoService'
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
  PENDING: 'text-medium',
  REGISTERED: 'text-low',
  REVOKED: 'text-forbidden',
}

type KeyState = 'ready' | 'waiting' | 'none'

const STATE_VIEW: Record<KeyState, { label: string; color: string; text: string }> = {
  ready: { label: '등록됨', color: 'text-low', text: '이 기기에서 승인할 수 있습니다.' },
  waiting: { label: '등록 대기', color: 'text-medium', text: '관리자 등록을 기다리고 있습니다.' },
  none: { label: '없음', color: 'text-ink', text: '이 브라우저에서 키를 만들고 관리자 등록을 받으면 승인할 수 있습니다.' },
}

function shorten(key: string) {
  return key.length > 20 ? `${key.slice(0, 20)}…` : key
}

class PinMismatchError extends Error {
  constructor() {
    super('웹쉘 공개키가 고정해 둔 키와 다릅니다')
    this.name = 'PinMismatchError'
  }
}

function stepsFor(state: KeyState): Step[] {
  const labels = ['키 만들기', '웹쉘 공개키 고정', '공개키 제출', '관리자 등록']
  if (state === 'ready') return labels.map((label) => ({ key: label, label, state: 'done' }))
  if (state === 'waiting') {
    return labels.map((label, i) => ({ key: label, label, state: i < 3 ? 'done' : 'current' }))
  }
  return labels.map((label, i) => ({ key: label, label, state: i === 0 ? 'current' : 'todo' }))
}

/** 승인 키 등록 (ADM-09): 기기에서 키 생성 → 웹쉘 공개키 고정 → 공개키 제출 → 관리자 등록 */
export function SigningKeySection({ me }: { me: Me }) {
  const refreshAll = useRefreshAll()
  const keys = useQuery({
    queryKey: ['me', 'signing-keys'],
    queryFn: async () => (await meApi.signingKeys()).items,
  })
  const localSigningKey = useQuery({
    queryKey: ['device-signing-key', me.id],
    queryFn: () => signingService.hasDeviceKey(me.id),
  })
  const device = deviceStore.get(me.id)
  const hasDeviceKey = localSigningKey.data === true
  const deviceKeyStatus = keys.data?.find((key) => key.id === device.keyId)?.status
  // 고정한 웹쉘 공개키가 없으면 서명을 암호화할 수 없어 쓸 수 없는 키다. 새로 만들어 고정한다.
  const deviceKeyUsable =
    hasDeviceKey &&
    device.keyMigrationStatus !== 'NEEDS_REENROLLMENT' &&
    Boolean(device.pinnedWebshellKey) &&
    (deviceKeyStatus === 'REGISTERED' || deviceKeyStatus === 'PENDING')
  // 서버는 폐기되지 않은 키를 사용자당 하나만 받는다. 남은 키가 있으면 폐기되기 전까지 새로 만들 수 없다.
  const hasActiveKey = keys.data?.some((key) => key.status !== 'REVOKED') ?? false
  const isAdmin = me.role === 'ADMIN'

  const [pinMismatch, setPinMismatch] = useState(false)

  const create = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      // 웹쉘 공개키를 먼저 받아 둔다. 여기서 실패하면 기존 기기 키를 덮어쓰지 않는다.
      const webshellKey = await meApi.webshellPublicKey()
      const before = deviceStore.get(me.id)
      // 고정의 목적: 서버가 다른 키를 내밀어도 받아들이지 않는다.
      const pinned = before.pinnedWebshellKey
      if (pinned && (pinned.encryption.publicKey !== webshellKey.encryption.publicKey || pinned.signing.publicKey !== webshellKey.signing.publicKey)) {
        throw new PinMismatchError()
      }
      cryptoService.assertWebshellKey(webshellKey)
      const previousKey = await signingService.snapshotDeviceKey(me.id)
      const { publicKey } = await signingService.generateDeviceKey(me.id)
      deviceStore.update(me.id, { pinnedWebshellKey: webshellKey })
      try {
        const key = await meApi.submitSigningKey(publicKey)
        deviceStore.update(me.id, { keyId: key.id })
        return key
      } catch (error) {
        // 제출에 실패하면 새 공개키와 옛 keyId가 섞이지 않게 IndexedDB의 키 쌍도 복원한다.
        await signingService.restoreDeviceKey(me.id, previousKey)
        deviceStore.update(me.id, {
          keyId: before.keyId,
          publicKey: before.publicKey,
          keyMigrationStatus: before.keyMigrationStatus,
          pinnedWebshellKey: before.pinnedWebshellKey,
        })
        throw error
      }
    },
    onMutate: () => setPinMismatch(false),
    onSuccess: async () => {
      toast.success(isAdmin ? '승인 키를 만들어 제출했습니다. 설정의 승인 키 탭에서 등록해 주세요' : '승인 키를 만들어 제출했습니다. 관리자 등록을 기다려 주세요')
      await localSigningKey.refetch()
      await refreshAll()
    },
    onError: (error) => {
      if (error instanceof PinMismatchError) setPinMismatch(true)
      else toast.error(errorMessage(error))
    },
  })

  const state: KeyState = deviceKeyUsable && deviceKeyStatus === 'REGISTERED' ? 'ready' : deviceKeyUsable ? 'waiting' : 'none'
  const view = STATE_VIEW[state]
  const elsewhere = state === 'none' && hasActiveKey
  const needsReenrollment = device.keyMigrationStatus === 'NEEDS_REENROLLMENT'
  const revoked = state === 'none' && !hasActiveKey && deviceKeyStatus === 'REVOKED'
  // 키 목록을 모르는 동안에는 만들기를 내놓지 않는다. 서버가 거절할 요청을 보내게 된다.
  const canCreate = keys.isSuccess && localSigningKey.isSuccess && !hasActiveKey
  const stateMessage = (() => {
    if (revoked) return '승인하려면 새 키를 만들어 주세요.'
    if (elsewhere && needsReenrollment) {
      return isAdmin
        ? '기존 키를 이 브라우저로 안전하게 옮기지 못했습니다. 설정의 승인 키 탭에서 기존 키를 폐기한 뒤 새 키를 등록해 주세요.'
        : '기존 키를 이 브라우저로 안전하게 옮기지 못했습니다. 관리자에게 기존 키 폐기와 재등록을 요청해 주세요.'
    }
    if (elsewhere) {
      return isAdmin
        ? '다른 기기의 키가 남아 있습니다. 설정의 승인 키 탭에서 폐기하면 이 브라우저에서 새로 만들 수 있습니다.'
        : '다른 기기의 키가 남아 있습니다. 관리자가 폐기하면 이 브라우저에서 새로 만들 수 있습니다.'
    }
    if (needsReenrollment) return '기존 키를 이 브라우저로 안전하게 옮기지 못했습니다. 새 키를 만들어 관리자 등록을 받아 주세요.'
    if (state === 'waiting' && isAdmin) return '설정의 승인 키 탭에서 직접 등록해 주세요.'
    return view.text
  })()

  return (
    <Sheet flush>
      <div className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-sm font-medium text-ink-2">승인 키</h2>
          {keys.isPending && <Spinner />}
          {keys.isError && <ErrorState error={keys.error} onRetry={() => keys.refetch()} />}
          {keys.isSuccess && (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className={`text-[2rem] leading-tight font-semibold tracking-[-0.02em] ${view.color}`}>
                  {revoked ? '폐기됨' : elsewhere ? '이 기기에 없음' : view.label}
                </p>
                <p className="mt-1 text-sm text-ink-2">
                  {stateMessage}
                </p>
              </div>
              {canCreate && (
                <Button
                  variant="primary"
                  size="lg"
                  internalOnly
                  loading={create.isPending}
                  onClick={() => create.mutate()}
                >
                  이 기기에서 키 만들기
                </Button>
              )}
            </div>
          )}
        </div>

        {pinMismatch && (
          <Banner tone="danger" title="웹쉘 공개키가 고정해 둔 키와 다릅니다">
            새 키를 만들지 않았습니다. 웹 서비스가 다른 키를 내미는 것일 수 있으니 관리자에게 알려 주세요.
          </Banner>
        )}

        {localSigningKey.isError && (
          <ErrorState error={localSigningKey.error} onRetry={() => localSigningKey.refetch()} />
        )}

        {keys.isSuccess && (
          <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm text-ink-3 hover:text-ink-2 [&::-webkit-details-marker]:hidden">
              자세히
              <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="mt-4 flex flex-col gap-4">
              <Stepper steps={stepsFor(state)} />
              <p className="text-sm text-ink-2">
                승인 서명은 이 브라우저 프로필에 저장된 비추출 키로 만듭니다. 로그아웃해도 키는 이 브라우저에 남고 계정별로 분리됩니다. 다른 브라우저나 기기로 복사·복구할 수 없으므로 기기를 바꾸거나 브라우저 저장 데이터를 지운 경우 관리자에게 기존 키 폐기와 재등록을 요청해 주세요.
              </p>
              {device.pinnedWebshellKey && (
                <p className="text-sm text-ink-2">
                  고정한 웹쉘 공개키 지문: 암호화 <Mono>{shorten(device.pinnedWebshellKey.encryption.fingerprint)}</Mono>, 서명{' '}
                  <Mono>{shorten(device.pinnedWebshellKey.signing.fingerprint)}</Mono>
                </p>
              )}
              {keys.data.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="sheet-table">
                    <thead>
                      <tr>
                        <th>키</th>
                        <th>공개키</th>
                        <th>상태</th>
                        <th>제출</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.data.map((key) => (
                        <tr key={key.id}>
                          <td className="whitespace-nowrap">
                            <Mono>{key.id}</Mono>
                            {key.id === device.keyId && <span className="ml-1.5 text-xs text-ink-3">이 기기</span>}
                          </td>
                          <td title={key.publicKey}>
                            <Mono>{shorten(key.publicKey)}</Mono>
                          </td>
                          <td>
                            <span className={`text-xs font-semibold whitespace-nowrap ${STATUS_CLASS[key.status]}`}>
                              {STATUS_LABEL[key.status]}
                            </span>
                          </td>
                          <td className="whitespace-nowrap">{formatDateTime(key.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    </Sheet>
  )
}
