import { useQueryClient } from '@tanstack/react-query'
import { MessageSquare, RotateCcw, Wrench, X } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'
import { networkStore } from '../api/client'
import { devControls } from '../api/mock'
import type { Network } from '../api/types'
import { formatDateTime } from '../lib/format'
import { NETWORK_LABEL, ROLE_LABEL } from '../lib/labels'
import { useNetwork } from '../lib/queries'
import { useAuth } from './AuthProvider'
import { toast } from '../components/toast'

let snapshot = devControls.state()
const subscribe = (listener: () => void) =>
  devControls.subscribe(() => {
    snapshot = devControls.state()
    listener()
  })

/** 시연용 개발 툴바: 사용자(역할) 전환, 내부망/외부망 전환, 목 데이터 초기화 */
export default function DevToolbar() {
  const state = useSyncExternalStore(subscribe, () => snapshot)
  const [open, setOpen] = useState(true)
  const [slackOpen, setSlackOpen] = useState(false)
  const { me, signIn } = useAuth()
  const client = useQueryClient()
  const navigate = useNavigate()
  const network = useNetwork()

  // 로그인 전에도 배지가 맞도록 목 서버의 망 값을 바로 알린다.
  useEffect(() => {
    networkStore.set(state.network)
  }, [state.network])

  const switchUser = async (userId: string) => {
    await signIn(devControls.switchUser(userId))
    navigate('/')
  }

  const switchNetwork = async (next: Network) => {
    devControls.setNetwork(next)
    networkStore.set(next)
    await client.invalidateQueries()
  }

  const reset = async () => {
    devControls.reset()
    await client.invalidateQueries()
    toast.success('목 데이터를 초기화했습니다')
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 flex items-center gap-1.5 rounded-full bg-ink px-3 py-2 text-xs font-medium text-white shadow-lg"
      >
        <Wrench size={14} aria-hidden />
        개발 도구
      </button>
    )
  }

  return (
    <aside
      aria-label="개발용 전환 툴바"
      className="fixed right-4 bottom-4 z-40 w-64 rounded-lg bg-ink p-3 text-xs text-white shadow-xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-semibold">
          <Wrench size={14} aria-hidden />
          개발 도구
        </span>
        <button type="button" onClick={() => setOpen(false)} aria-label="개발 도구 접기" className="text-white/70 hover:text-white">
          <X size={15} />
        </button>
      </div>

      <label className="mb-1 block text-white/70" htmlFor="dev-user">
        로그인 사용자
      </label>
      <select
        id="dev-user"
        value={me?.id ?? ''}
        onChange={(event) => switchUser(event.target.value)}
        className="mb-2.5 w-full rounded bg-white/10 px-2 py-1.5 text-white [&>option]:text-ink"
      >
        {!me && <option value="">로그아웃 상태</option>}
        {state.users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} ({ROLE_LABEL[user.role]})
          </option>
        ))}
      </select>

      <p className="mb-1 text-white/70">접속 환경</p>
      <div className="mb-2.5 grid grid-cols-2 gap-1 rounded bg-white/10 p-0.5" role="group" aria-label="접속 환경">
        {(['INTERNAL', 'EXTERNAL'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={network === value}
            onClick={() => switchNetwork(value)}
            className={`rounded py-1 font-medium ${network === value ? 'bg-white text-ink' : 'text-white/80 hover:text-white'}`}
          >
            {NETWORK_LABEL[value]}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setSlackOpen((v) => !v)}
          aria-expanded={slackOpen}
          className="flex flex-1 items-center justify-center gap-1 rounded bg-white/10 py-1.5 hover:bg-white/20"
        >
          <MessageSquare size={13} aria-hidden />
          Slack 알림 {state.slackOutbox.length}
        </button>
        <button
          type="button"
          onClick={reset}
          className="flex flex-1 items-center justify-center gap-1 rounded bg-white/10 py-1.5 hover:bg-white/20"
        >
          <RotateCcw size={13} aria-hidden />
          데이터 초기화
        </button>
      </div>

      {slackOpen && (
        <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
          {state.slackOutbox.length === 0 && <li className="py-2 text-center text-white/60">보낸 알림이 없습니다</li>}
          {state.slackOutbox.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                onClick={() => navigate(message.link)}
                className="w-full rounded bg-white/5 p-1.5 text-left hover:bg-white/15"
              >
                <span className="text-white/60">
                  {message.toName}에게, {formatDateTime(message.at)}
                </span>
                <br />
                {message.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
