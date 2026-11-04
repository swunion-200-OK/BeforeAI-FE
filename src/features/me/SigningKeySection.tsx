import { useMutation, useQuery } from '@tanstack/react-query'
import { Hourglass, KeyRound, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { meApi } from '../../api/endpoints'
import { errorMessage } from '../../api/errors'
import type { Me, SigningKeyStatus } from '../../api/types'
import { Stepper, type Step } from '../../components/RequestStepper'
import { toast } from '../../components/toast'
import { Banner, Button, ConfirmModal, ErrorState, Mono, Sheet, Spinner } from '../../components/ui'
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

const HERO = {
  ready: {
    Icon: ShieldCheck,
    box: 'bg-low-soft',
    icon: 'bg-low text-white',
    title: '이 기기에서 승인할 수 있습니다',
    text: '승인 서명은 이 기기에 있는 개인키로 만듭니다. 개인키는 기기 밖으로 나가지 않습니다.',
  },
  waiting: {
    Icon: Hourglass,
    box: 'bg-medium-soft',
    icon: 'bg-medium text-white',
    title: '관리자 등록을 기다리고 있습니다',
    text: '관리자가 실행기에 공개키를 등록하면 승인할 수 있습니다.',
  },
  none: {
    Icon: KeyRound,
    box: 'bg-seal-soft',
    icon: 'bg-seal text-white',
    title: '승인 키 등록 필요',
    text: '이 기기에서 키를 만들어 제출하고 관리자 등록을 받으면 승인할 수 있습니다.',
  },
} satisfies Record<string, { Icon: LucideIcon; box: string; icon: string; title: string; text: string }>

function shorten(key: string) {
  return key.length > 20 ? `${key.slice(0, 20)}…` : key
}

class PinMismatchError extends Error {
  constructor() {
    super('실행기 공개키가 고정해 둔 키와 다릅니다')
    this.name = 'PinMismatchError'
  }
}

function stepsFor(state: keyof typeof HERO): Step[] {
  const labels = ['키 만들기', '실행기 공개키 고정', '공개키 제출', '관리자 등록']
  if (state === 'ready') return labels.map((label) => ({ key: label, label, state: 'done' }))
  if (state === 'waiting') {
    return labels.map((label, i) => ({ key: label, label, state: i < 3 ? 'done' : 'current' }))
  }
  return labels.map((label, i) => ({ key: label, label, state: i === 0 ? 'current' : 'todo' }))
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
  // 다른 기기에 살아 있는 키가 있으면 새로 만들기 전에 확인한다.
  const activeKeyElsewhere = keys.data?.some((key) => key.status !== 'REVOKED') ?? false

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pinMismatch, setPinMismatch] = useState(false)

  const create = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      // 실행기 공개키를 먼저 받아 둔다. 여기서 실패하면 기존 기기 키를 덮어쓰지 않는다.
      const { publicKey: executorKey } = await meApi.executorPublicKey()
      const before = deviceStore.get(me.id)
      // 고정의 목적: 서버가 다른 키를 내밀어도 받아들이지 않는다.
      if (before.pinnedExecutorKey && before.pinnedExecutorKey !== executorKey) throw new PinMismatchError()
      const { publicKey } = signingService.generateDeviceKey(me.id)
      deviceStore.update(me.id, { pinnedExecutorKey: executorKey })
      try {
        const key = await meApi.submitSigningKey(publicKey)
        deviceStore.update(me.id, { keyId: key.keyId })
        return key
      } catch (error) {
        // 제출에 실패하면 새 비밀키와 옛 keyId가 섞이지 않게 이전 상태로 되돌린다.
        deviceStore.update(me.id, {
          keyId: before.keyId,
          secretKey: before.secretKey,
          publicKey: before.publicKey,
          pinnedExecutorKey: before.pinnedExecutorKey,
        })
        throw error
      }
    },
    onMutate: () => setPinMismatch(false),
    onSuccess: async () => {
      setConfirmOpen(false)
      toast.success('승인 키를 만들어 제출했습니다. 관리자 등록을 기다려 주세요')
      await refreshAll()
    },
    onError: (error) => {
      setConfirmOpen(false)
      if (error instanceof PinMismatchError) setPinMismatch(true)
      else toast.error(errorMessage(error))
    },
  })

  const state: keyof typeof HERO =
    hasDeviceKey && deviceKeyStatus === 'REGISTERED' ? 'ready' : deviceKeyUsable ? 'waiting' : 'none'
  const hero = HERO[state]
  // 키 목록을 모르는 동안에는 만들기를 내놓지 않는다. 등록된 기기의 키를 모르고 덮어쓰면 서명이 막힌다.
  const canCreate = keys.isSuccess && !deviceKeyUsable

  return (
    <Sheet title="승인 키" icon={<KeyRound size={16} />}>
      <div className="flex flex-col gap-4">
        {keys.isSuccess && (
          <>
            <div className={`flex items-center gap-3.5 rounded-xl p-4 ${hero.box}`}>
              <span className={`inline-flex size-12 shrink-0 items-center justify-center rounded-full ${hero.icon}`}>
                <hero.Icon size={24} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold tracking-tight text-ink">{hero.title}</p>
                <p className="mt-0.5 text-[0.8125rem] text-ink-2">
                  {state === 'none' && deviceKeyStatus === 'REVOKED'
                    ? '이 기기의 키가 폐기되었습니다. 승인하려면 새 키를 만들어 주세요.'
                    : state === 'none' && activeKeyElsewhere
                      ? '다른 기기에 등록된 키가 있습니다. 이 기기에서 승인하려면 새 키를 만들어 주세요.'
                      : hero.text}
                </p>
              </div>
              {canCreate && (
                <Button
                  variant="primary"
                  internalOnly
                  loading={create.isPending}
                  onClick={() => (activeKeyElsewhere ? setConfirmOpen(true) : create.mutate())}
                >
                  이 기기에서 키 만들기
                </Button>
              )}
            </div>
            <Stepper steps={stepsFor(state)} />
          </>
        )}

        {pinMismatch && (
          <Banner tone="danger" title="실행기 공개키가 고정해 둔 키와 다릅니다">
            새 키를 만들지 않았습니다. 웹 서비스가 다른 키를 내미는 것일 수 있으니 관리자에게 알려 주세요.
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
          <div className="overflow-x-auto rounded-lg border border-rule">
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

      <ConfirmModal
        open={confirmOpen}
        title="이 기기에서 새 키를 만듭니다"
        confirmLabel="이 기기에서 키 만들기"
        loading={create.isPending}
        onConfirm={() => create.mutate()}
        onClose={() => setConfirmOpen(false)}
      >
        이미 등록하거나 제출한 키가 있습니다. 새 키는 관리자 등록을 받아야 쓸 수 있고, 그때까지 이 기기에서는 승인할 수 없습니다.
      </ConfirmModal>
    </Sheet>
  )
}
