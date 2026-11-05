import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { adminApi } from '../../api/endpoints'
import type { AdminSigningKey, SigningKeyStatus } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { toast } from '../../components/toast'
import { Button, ConfirmModal, EmptyState, ErrorState, Mono, Sheet, Spinner } from '../../components/ui'
import { deviceStore } from '../../crypto/deviceStore'
import { signingService } from '../../crypto/signingService'
import { formatDateTime } from '../../lib/format'
import { useRefreshAll } from '../../lib/queries'
import { signingKeysQuery, usersQuery } from './adminQueries'

const STATUS: Record<SigningKeyStatus, { label: string; className: string }> = {
  PENDING: { label: '등록 대기', className: 'text-medium' },
  REGISTERED: { label: '등록됨', className: 'text-ink-2' },
  REVOKED: { label: '폐기됨', className: 'text-ink-3' },
}

/**
 * 등록 서명을 만들 수 없는 이유. 서버 규칙: 서명 키는 관리자 본인의 등록된 키여야 하고,
 * 등록된 키가 아직 없으면(첫 관리자) 본인의 대기 키만 그 키 자신으로 서명해 등록할 수 있다.
 */
function registerBlockedReason(target: AdminSigningKey, adminKey: AdminSigningKey | undefined): string | null {
  if (!adminKey) return '이 기기에 관리자 승인 키가 없습니다. 내 정보에서 키를 만들어 주세요'
  if (adminKey.status === 'REGISTERED' || adminKey.id === target.id) return null
  return adminKey.status === 'PENDING'
    ? '먼저 관리자 본인의 승인 키를 등록해 주세요'
    : '이 기기의 승인 키가 폐기되었습니다. 내 정보에서 새로 만들어 주세요'
}

/** onRegister를 주면 등록 대기 표가 된다: 상태 칸을 빼고 등록 버튼을 단다. */
function KeyTable({
  keys,
  ownerName,
  onRegister,
  blockedReason,
  onRevoke,
  registeringId,
}: {
  keys: AdminSigningKey[]
  ownerName: (key: AdminSigningKey) => string
  onRegister?: (key: AdminSigningKey) => void
  blockedReason?: (key: AdminSigningKey) => string | null
  onRevoke: (key: AdminSigningKey) => void
  registeringId?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="sheet-table [&_td]:py-3">
        <thead>
          <tr>
            <th>사용자</th>
            <th>키 ID</th>
            <th>공개키</th>
            {!onRegister && <th>상태</th>}
            <th>제출 시각</th>
            <th aria-label="동작" />
          </tr>
        </thead>
        <tbody>
          {keys.map((key, index) => (
            <tr key={key.id}>
              <td className="font-medium whitespace-nowrap">{ownerName(key)}</td>
              <td>
                <Mono>{key.id}</Mono>
              </td>
              <td title={key.publicKey}>
                <Mono className="text-ink-3">{key.publicKey.slice(0, 16)}…</Mono>
              </td>
              {!onRegister && <td className={`whitespace-nowrap ${STATUS[key.status].className}`}>{STATUS[key.status].label}</td>}
              <td className="whitespace-nowrap text-ink-2">{formatDateTime(key.createdAt)}</td>
              <td>
                <div className="flex justify-end gap-1.5">
                  {onRegister && (
                    <Button
                      size="sm"
                      variant={index === 0 ? 'primary' : 'secondary'}
                      loading={registeringId === key.id}
                      disabled={Boolean(blockedReason?.(key))}
                      disabledReason={blockedReason?.(key)}
                      onClick={() => onRegister(key)}
                    >
                      등록
                    </Button>
                  )}
                  {key.status !== 'REVOKED' && (
                    <Button size="sm" onClick={() => onRevoke(key)}>
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
  const me = useMe()
  const [revoking, setRevoking] = useState<AdminSigningKey | null>(null)
  const keys = useQuery(signingKeysQuery)
  // 키 응답에는 userId만 있어 이름은 계정 목록에서 찾는다.
  const users = useQuery(usersQuery)
  const ownerName = (key: AdminSigningKey) =>
    users.data?.find((user) => user.id === key.userId)?.name ?? `사용자 ${key.userId.slice(0, 8)}`
  const register = useMutation({
    mutationFn: (key: AdminSigningKey) => adminApi.registerKey(key.id, signingService.signRegisterProof(me.id, key)),
    onSuccess: async (_result, key) => {
      toast.success(`${ownerName(key)}님의 승인 키를 등록했습니다. 이제 승인 서명을 할 수 있습니다`)
      await refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: (key: AdminSigningKey) => adminApi.revokeKey(key.id),
    onSuccess: async (_result, key) => {
      toast.success(`${ownerName(key)}님의 승인 키를 폐기했습니다`)
      setRevoking(null)
      await refresh()
    },
  })

  if (keys.isPending) return <Spinner />
  if (keys.isError) return <ErrorState error={keys.error} onRetry={() => keys.refetch()} />

  const pending = keys.data.filter((key) => key.status === 'PENDING')
  const others = keys.data.filter((key) => key.status !== 'PENDING')
  const deviceKeyId = deviceStore.get(me.id).keyId
  const adminKey = signingService.hasDeviceKey(me.id)
    ? keys.data.find((key) => key.id === deviceKeyId && key.userId === me.id)
    : undefined

  return (
    <div className="flex flex-col gap-4">
      {pending.length > 0 && (
        <Sheet
          title={`등록 대기 ${pending.length}건`}
          flush
          actions={<span className="text-sm text-ink-2">등록하면 웹쉘 정책에 반영되어 이 키로 승인할 수 있습니다.</span>}
        >
          <KeyTable
            keys={pending}
            ownerName={ownerName}
            onRegister={(key) => register.mutate(key)}
            blockedReason={(key) => registerBlockedReason(key, adminKey)}
            onRevoke={setRevoking}
            registeringId={register.isPending ? register.variables?.id : undefined}
          />
        </Sheet>
      )}
      {(others.length > 0 || pending.length === 0) && (
        <Sheet title="승인 키" flush>
          {others.length === 0 ? (
            <EmptyState title="아직 등록된 키가 없습니다">사용자가 내 정보에서 이 기기의 키를 만들면 여기에 나타납니다.</EmptyState>
          ) : (
            <KeyTable keys={others} ownerName={ownerName} onRevoke={setRevoking} />
          )}
        </Sheet>
      )}
      <ConfirmModal
        open={Boolean(revoking)}
        title="승인 키 폐기"
        confirmLabel="폐기"
        danger
        loading={revoke.isPending}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      >
        {revoking && ownerName(revoking)}님의 키 <Mono>{revoking?.id ?? ''}</Mono>를 폐기합니다. 웹쉘에 바로 반영되어 이 키의 서명은
        더 이상 검증을 통과하지 못합니다.
      </ConfirmModal>
    </div>
  )
}
