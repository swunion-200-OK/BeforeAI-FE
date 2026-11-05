import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { adminApi } from '../../api/endpoints'
import type { SigningKey, SigningKeyStatus } from '../../api/types'
import { toast } from '../../components/toast'
import { Button, ConfirmModal, EmptyState, ErrorState, Mono, Sheet, Spinner } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { useRefreshAll } from '../../lib/queries'
import { signingKeysQuery } from './adminQueries'

const STATUS: Record<SigningKeyStatus, { label: string; className: string }> = {
  PENDING: { label: '등록 대기', className: 'text-medium' },
  REGISTERED: { label: '등록됨', className: 'text-ink-2' },
  REVOKED: { label: '폐기됨', className: 'text-ink-3' },
}

/** onRegister를 주면 등록 대기 표가 된다: 상태 대신 제출 시각을 보여 주고 등록 버튼을 단다. */
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
      <table className="sheet-table [&_td]:py-3">
        <thead>
          <tr>
            <th>사용자</th>
            <th>키 ID</th>
            <th>공개키</th>
            {onRegister ? (
              <th>제출 시각</th>
            ) : (
              <>
                <th>상태</th>
                <th>등록 시각</th>
              </>
            )}
            <th aria-label="동작" />
          </tr>
        </thead>
        <tbody>
          {keys.map((key, index) => (
            <tr key={key.keyId}>
              <td className="font-medium whitespace-nowrap">{key.userName}</td>
              <td>
                <Mono>{key.keyId}</Mono>
              </td>
              <td title={key.publicKey}>
                <Mono className="text-ink-3">{key.publicKey.slice(0, 16)}…</Mono>
              </td>
              {onRegister ? (
                <td className="whitespace-nowrap text-ink-2">{formatDateTime(key.createdAt)}</td>
              ) : (
                <>
                  <td className={`whitespace-nowrap ${STATUS[key.status].className}`}>{STATUS[key.status].label}</td>
                  <td className="whitespace-nowrap text-ink-2" title={`제출 ${formatDateTime(key.createdAt)}`}>
                    {key.registeredAt ? formatDateTime(key.registeredAt) : '-'}
                  </td>
                </>
              )}
              <td>
                <div className="flex justify-end gap-1.5">
                  {onRegister && (
                    <Button
                      size="sm"
                      variant={index === 0 ? 'primary' : 'secondary'}
                      loading={registeringId === key.keyId}
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
            onRegister={(key) => register.mutate(key)}
            onRevoke={setRevoking}
            registeringId={register.isPending ? register.variables?.keyId : undefined}
          />
        </Sheet>
      )}
      {(others.length > 0 || pending.length === 0) && (
        <Sheet title="승인 키" flush>
          {others.length === 0 ? (
            <EmptyState title="아직 등록된 키가 없습니다">사용자가 내 정보에서 이 기기의 키를 만들면 여기에 나타납니다.</EmptyState>
          ) : (
            <KeyTable keys={others} onRevoke={setRevoking} />
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
        {revoking?.userName}님의 키 <Mono>{revoking?.keyId ?? ''}</Mono>를 폐기합니다. 웹쉘에 바로 반영되어 이 키의 서명은
        더 이상 검증을 통과하지 못합니다.
      </ConfirmModal>
    </div>
  )
}
