import { useMutation, useQuery } from '@tanstack/react-query'
import { Ban, Hourglass, KeyRound, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { adminApi } from '../../api/endpoints'
import type { SigningKey, SigningKeyStatus } from '../../api/types'
import { StatCard, UserChip } from '../../components/rich'
import { toast } from '../../components/toast'
import { Button, ConfirmModal, EmptyState, ErrorState, Mono, Sheet, Spinner } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { useRefreshAll } from '../../lib/queries'
import { signingKeysQuery } from './adminQueries'

const STATUS: Record<SigningKeyStatus, { label: string; className: string }> = {
  PENDING: { label: '등록 대기', className: 'bg-medium-soft text-medium' },
  REGISTERED: { label: '등록됨', className: 'bg-low-soft text-low' },
  REVOKED: { label: '폐기됨', className: 'bg-forbidden-soft text-forbidden' },
}

function KeyTable({
  keys,
  onRegister,
  onRevoke,
  registeringId,
}: {
  keys: SigningKey[]
  onRegister?: (key: SigningKey) => void
  onRevoke: (key: SigningKey) => void
  registeringId?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="sheet-table">
        <thead>
          <tr>
            <th>사용자</th>
            <th>키 ID</th>
            <th>공개키</th>
            <th>상태</th>
            <th>제출 시각</th>
            <th>등록 시각</th>
            <th aria-label="동작" />
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key.keyId}>
              <td>
                <UserChip name={key.userName} />
              </td>
              <td>
                <Mono>{key.keyId}</Mono>
              </td>
              <td title={key.publicKey}>
                <Mono>{key.publicKey.slice(0, 16)}…</Mono>
              </td>
              <td>
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS[key.status].className}`}>
                  {STATUS[key.status].label}
                </span>
              </td>
              <td className="whitespace-nowrap text-ink-2">{formatDateTime(key.createdAt)}</td>
              <td className="whitespace-nowrap text-ink-2">{key.registeredAt ? formatDateTime(key.registeredAt) : '-'}</td>
              <td>
                <div className="flex justify-end gap-1.5">
                  {onRegister && key.status === 'PENDING' && (
                    <Button
                      size="sm"
                      variant="primary"
                      loading={registeringId === key.keyId}
                      onClick={() => onRegister(key)}
                    >
                      등록
                    </Button>
                  )}
                  {key.status !== 'REVOKED' && (
                    <Button size="sm" variant="danger-outline" onClick={() => onRevoke(key)}>
                      폐기
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function KeysTab() {
  const refresh = useRefreshAll()
  const [revoking, setRevoking] = useState<SigningKey | null>(null)
  const keys = useQuery(signingKeysQuery)
  const register = useMutation({
    mutationFn: (key: SigningKey) => adminApi.registerKey(key.keyId),
    onSuccess: async (key) => {
      toast.success(`${key.userName}님의 승인 키를 등록했습니다. 이제 승인 서명을 할 수 있습니다`)
      await refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: (key: SigningKey) => adminApi.revokeKey(key.keyId),
    onSuccess: async (key) => {
      toast.success(`${key.userName}님의 승인 키를 폐기했습니다`)
      setRevoking(null)
      await refresh()
    },
  })

  if (keys.isPending) return <Spinner />
  if (keys.isError) return <ErrorState error={keys.error} onRetry={() => keys.refetch()} />

  const pending = keys.data.filter((key) => key.status === 'PENDING')
  const others = keys.data.filter((key) => key.status !== 'PENDING')
  const registered = others.filter((key) => key.status === 'REGISTERED').length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="등록을 기다리는 키"
          value={pending.length}
          icon={Hourglass}
          tone={pending.length > 0 ? 'amber' : 'neutral'}
          hint={pending.length > 0 ? '등록 전에는 승인할 수 없습니다' : '처리할 키가 없습니다'}
        />
        <StatCard label="실행기에 등록된 키" value={registered} icon={ShieldCheck} tone="green" hint="이 키의 서명만 실행기가 인정합니다" />
        <StatCard label="폐기한 키" value={others.length - registered} icon={Ban} tone="neutral" hint="폐기하면 실행기에 바로 반영됩니다" />
      </div>

      <Sheet
        title={`등록 대기 ${pending.length}건`}
        icon={<Hourglass size={16} aria-hidden />}
        flush
        className={pending.length > 0 ? 'border-medium ring-2 ring-medium/25' : ''}
      >
        <p className="border-b border-rule px-4 py-2 text-[0.8125rem] text-ink-2">
          등록한 공개키는 관리자 서명과 함께 실행기 로컬 정책에 반영됩니다. 등록 전에는 승인할 수 없습니다.
        </p>
        {pending.length === 0 ? (
          <EmptyState title="등록을 기다리는 키가 없습니다">
            사용자가 내 정보에서 이 기기의 키를 만들면 여기에 나타납니다.
          </EmptyState>
        ) : (
          <KeyTable
            keys={pending}
            onRegister={(key) => register.mutate(key)}
            onRevoke={setRevoking}
            registeringId={register.isPending ? register.variables?.keyId : undefined}
          />
        )}
      </Sheet>
      <Sheet title="등록·폐기된 키" icon={<KeyRound size={16} aria-hidden />} flush>
        {others.length === 0 ? <EmptyState title="아직 등록된 키가 없습니다" /> : <KeyTable keys={others} onRevoke={setRevoking} />}
      </Sheet>
      <ConfirmModal
        open={Boolean(revoking)}
        title="승인 키 폐기"
        confirmLabel="폐기"
        danger
        loading={revoke.isPending}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      >
        {revoking?.userName}님의 키 <Mono>{revoking?.keyId ?? ''}</Mono>를 폐기합니다. 실행기에 바로 반영되어 이 키의 서명은
        더 이상 검증을 통과하지 못합니다.
      </ConfirmModal>
    </div>
  )
}
