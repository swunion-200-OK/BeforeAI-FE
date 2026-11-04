import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, MessageSquare, PlayCircle, RotateCcw, Wrench, X } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'
import { networkStore } from '../api/client'
import { devControls } from '../api/mock'
import type { Network } from '../api/types'
import { RequestStatusBadge } from '../components/badges'
import { toast } from '../components/toast'
import { formatDateTime } from '../lib/format'
import { NETWORK_LABEL, ROLE_LABEL } from '../lib/labels'
import { useNetwork } from '../lib/queries'
import { useAuth } from './AuthProvider'
import { DEMO_SCENARIOS, DEMO_STATUSES, SCENARIO_PROMPT, type DemoStep } from './demoGuide'

let snapshot = devControls.state()
const subscribe = (listener: () => void) =>
  devControls.subscribe(() => {
    snapshot = devControls.state()
    listener()
  })

/** 시연용 개발 도구: 사용자(역할) 전환, 내부망/외부망 전환, 목 데이터 초기화, 시연 가이드 */
export default function DevToolbar() {
  const state = useSyncExternalStore(subscribe, () => snapshot)
  // 자동화 테스트에서는 펼쳐 두고, 사람이 볼 때는 화면을 가리지 않게 접어 둔다.
  const [open, setOpen] = useState(() => navigator.webdriver)
  const [slackOpen, setSlackOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [activeStep, setActiveStep] = useState<string | null>(null)
  const [pendingStep, setPendingStep] = useState<{ userId: string; path: string } | null>(null)
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

  // 사용자 전환이 화면에 반영된 뒤에 이동한다. 로그인 화면과 접근 가드의 자동 이동이 끝난 다음이어야 시연 단계가 덮이지 않는다.
  useEffect(() => {
    if (!pendingStep || me?.id !== pendingStep.userId) return
    const timer = setTimeout(() => {
      navigate(pendingStep.path)
      setPendingStep(null)
    })
    return () => clearTimeout(timer)
  }, [pendingStep, me?.id, navigate])

  /** 시연 단계로 이동: 그 단계의 사용자·망으로 바꾼 뒤 해당 화면을 연다. */
  const goTo = async (key: string, userId: string, nextNetwork: Network, path: string) => {
    setActiveStep(key)
    if (state.network !== nextNetwork) {
      devControls.setNetwork(nextNetwork)
      networkStore.set(nextNetwork)
    }
    if (me?.id !== userId) await signIn(devControls.switchUser(userId))
    else await client.invalidateQueries()
    setPendingStep({ userId, path })
  }

  const runStep = (key: string, step: DemoStep) =>
    goTo(key, step.userId, step.network, step.path(devControls.latestRequestId(SCENARIO_PROMPT)))

  const userName = (userId: string) => state.users.find((user) => user.id === userId)?.name ?? userId

  if (guideOpen) {
    // 사이드바 자리에 겹쳐 띄운다. 본문을 가리지 않아 가이드를 보면서 화면을 따라갈 수 있다.
    return (
      <aside
        aria-label="시연 가이드"
        className="quiet-scroll fixed top-0 bottom-0 left-0 z-40 w-[232px] overflow-y-auto bg-nav-2 p-3 text-xs text-white shadow-raised"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <PlayCircle size={15} aria-hidden />
            시연 가이드
          </span>
          <button type="button" onClick={() => setGuideOpen(false)} aria-label="시연 가이드 닫기" className="text-white/70 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={reset}
          className="mb-4 flex w-full items-center justify-center gap-1 rounded bg-white/10 py-1.5 hover:bg-white/20"
        >
          <RotateCcw size={13} aria-hidden />
          처음 상태로 초기화
        </button>

        {DEMO_SCENARIOS.map((group) => (
          <section key={group.title} className="mb-4">
            <h2 className="mb-1.5 font-semibold text-white">{group.title}</h2>
            <ol className="flex flex-col gap-1">
              {group.steps.map((step, index) => {
                const key = `${group.title}-${index}`
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => runStep(key, step)}
                      aria-current={activeStep === key ? 'step' : undefined}
                      className={`w-full rounded p-1.5 text-left ${
                        activeStep === key ? 'bg-seal text-white' : 'bg-white/5 hover:bg-white/15'
                      }`}
                    >
                      <span className="block">{step.label}</span>
                      <span className={`mt-0.5 block ${activeStep === key ? 'text-white/80' : 'text-white/55'}`}>
                        {userName(step.userId)}, {NETWORK_LABEL[step.network]}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}

        <section>
          <h2 className="mb-1.5 font-semibold text-white">상태별 화면</h2>
          <div className="flex flex-wrap gap-1">
            {DEMO_STATUSES.map((item) => (
              <button
                key={item.status}
                type="button"
                onClick={() => goTo(`status-${item.status}`, item.userId, 'INTERNAL', item.path)}
                className="rounded hover:ring-2 hover:ring-white/60"
              >
                <RequestStatusBadge status={item.status} />
              </button>
            ))}
          </div>
        </section>
      </aside>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[68px] left-2.5 z-40 flex w-[212px] items-center gap-1.5 rounded-lg bg-nav-2 px-2.5 py-1.5 text-xs font-medium text-nav-ink shadow-raised ring-1 ring-white/15 hover:text-white"
      >
        <Wrench size={14} aria-hidden />
        개발 도구
        <span className="ml-auto text-nav-dim">{NETWORK_LABEL[network]}</span>
      </button>
    )
  }

  return (
    <aside
      aria-label="개발용 전환 툴바"
      className="fixed bottom-[68px] left-2.5 z-40 w-[212px] rounded-lg bg-nav-2 p-3 text-xs text-white shadow-raised ring-1 ring-white/15"
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

      <button
        type="button"
        onClick={() => setGuideOpen(true)}
        className="mb-2.5 flex w-full items-center gap-1.5 rounded bg-seal px-2 py-1.5 font-medium hover:bg-seal-dark"
      >
        <PlayCircle size={14} aria-hidden />
        시연 가이드 열기
        <ChevronRight size={14} className="ml-auto" aria-hidden />
      </button>

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
