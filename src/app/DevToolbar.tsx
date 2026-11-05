import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Wrench, X } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { networkStore } from '../api/client'
import { devControls } from '../api/mock'
import { TAMPER_DEMO_PATH } from '../api/mock/tamperDemo'
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
  const { pathname } = useLocation()
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

  // 변조 시연을 떠나면 시연 요청을 지운다. 이 도구는 어느 화면에서나 떠 있어서 새로고침한 뒤 남은 요청도 여기서 치운다.
  useEffect(() => {
    if (devControls.tamper.sweep(pathname)) void client.invalidateQueries()
  }, [client, pathname])

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

  // 변조 시연은 창 전체를 쓰고, 나가는 길은 그 화면에 있다.
  if (pathname === TAMPER_DEMO_PATH) return null

  if (guideOpen) {
    // 사이드바 자리에 겹쳐 띄운다. 본문을 가리지 않아 가이드를 보면서 화면을 따라갈 수 있다.
    return (
      <aside
        aria-label="시연 가이드"
        className="quiet-scroll fixed top-0 bottom-0 left-0 z-40 w-[15rem] overflow-y-auto border-r border-rule bg-sheet p-3 text-xs text-ink"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">시연 가이드</span>
          <button type="button" onClick={() => setGuideOpen(false)} aria-label="시연 가이드 닫기" className="text-ink-3 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={reset}
          className="mb-4 w-full rounded-md border border-rule-strong py-1.5 font-medium hover:bg-sheet-alt"
        >
          처음 상태로 초기화
        </button>

        {DEMO_SCENARIOS.map((group) => (
          <section key={group.title} className="mb-4">
            <h2 className="mb-1.5 font-semibold">{group.title}</h2>
            <ol className="flex flex-col gap-1">
              {group.steps.map((step, index) => {
                const key = `${group.title}-${index}`
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => runStep(key, step)}
                      aria-current={activeStep === key ? 'step' : undefined}
                      className={`w-full rounded-md p-1.5 text-left ${
                        activeStep === key ? 'bg-seal-soft font-medium text-seal-dark' : 'hover:bg-sheet-alt'
                      }`}
                    >
                      <span className="block">{step.label}</span>
                      <span className="mt-0.5 block font-normal text-ink-3">
                        {userName(step.userId)}
                        {step.network === 'EXTERNAL' && `, ${NETWORK_LABEL.EXTERNAL}에서`}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}

        <section>
          <h2 className="mb-1.5 font-semibold">상태별 화면</h2>
          <div className="flex flex-wrap gap-1">
            {DEMO_STATUSES.map((item) => (
              <button
                key={item.status}
                type="button"
                onClick={() => goTo(`status-${item.status}`, item.userId, 'INTERNAL', item.path)}
                className="rounded-md border border-rule px-1.5 py-0.5 hover:bg-sheet-alt"
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
        className="fixed bottom-[4.25rem] left-2.5 z-40 flex w-[13.75rem] items-center gap-1.5 rounded-md border border-rule-strong bg-sheet px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-sheet-alt hover:text-ink"
      >
        <Wrench size={14} aria-hidden />
        개발 도구
        {network === 'EXTERNAL' && <span className="ml-auto text-ink-3">{NETWORK_LABEL.EXTERNAL}</span>}
      </button>
    )
  }

  return (
    <aside
      aria-label="개발용 전환 툴바"
      className="fixed bottom-[4.25rem] left-2.5 z-40 w-[13.75rem] rounded-xl border border-rule bg-sheet p-3 text-xs text-ink shadow-raised"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-semibold">
          <Wrench size={14} aria-hidden />
          개발 도구
        </span>
        <button type="button" onClick={() => setOpen(false)} aria-label="개발 도구 접기" className="text-ink-3 hover:text-ink">
          <X size={15} />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setGuideOpen(true)}
        className="mb-1.5 flex w-full items-center gap-1.5 rounded-md bg-seal px-2 py-1.5 font-medium text-white hover:bg-seal-dark"
      >
        시연 가이드 열기
        <ChevronRight size={14} className="ml-auto" aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => goTo('tamper', 'u-07', 'INTERNAL', TAMPER_DEMO_PATH)}
        className="mb-2.5 flex w-full items-center gap-1.5 rounded-md border border-rule-strong px-2 py-1.5 font-medium hover:bg-sheet-alt"
      >
        변조 시연 열기
        <ChevronRight size={14} className="ml-auto" aria-hidden />
      </button>

      <label className="mb-1 block text-ink-3" htmlFor="dev-user">
        로그인 사용자
      </label>
      <select
        id="dev-user"
        value={me?.id ?? ''}
        onChange={(event) => switchUser(event.target.value)}
        className="mb-2.5 w-full rounded-md border border-rule-input bg-sheet px-2 py-1.5 text-ink"
      >
        {!me && <option value="">로그아웃 상태</option>}
        {state.users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} ({ROLE_LABEL[user.role]})
          </option>
        ))}
      </select>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setSlackOpen((v) => !v)}
          aria-expanded={slackOpen}
          className="flex-1 rounded-md border border-rule-strong py-1.5 hover:bg-sheet-alt"
        >
          Slack 알림 {state.slackOutbox.length}
        </button>
        <button
          type="button"
          onClick={reset}
          className="flex-1 rounded-md border border-rule-strong py-1.5 hover:bg-sheet-alt"
        >
          데이터 초기화
        </button>
      </div>

      {/* 실제 서비스에서는 서버가 접속 IP로 판단하므로 이런 설정이 없다. 목 서버에서 외부망 동작을 보기 위한 전환이다. */}
      <div className="mt-2.5 border-t border-rule pt-2.5">
        <p className="mb-1 text-ink-3">접속 환경 (시연용)</p>
        <div className="grid grid-cols-2 gap-0.5 rounded-md border border-rule-strong p-0.5" role="group" aria-label="접속 환경">
          {(['INTERNAL', 'EXTERNAL'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={network === value}
              onClick={() => switchNetwork(value)}
              className={`rounded py-1 font-medium ${network === value ? 'bg-seal-soft font-semibold text-seal-dark' : 'text-ink-2 hover:bg-sheet-alt'}`}
            >
              {NETWORK_LABEL[value]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-ink-3">실제로는 서버가 접속 위치로 자동 판단합니다</p>
      </div>

      {slackOpen && (
        <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
          {state.slackOutbox.length === 0 && <li className="py-2 text-center text-ink-3">보낸 알림이 없습니다</li>}
          {state.slackOutbox.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                onClick={() => navigate(message.link)}
                className="w-full rounded-md p-1.5 text-left hover:bg-sheet-alt"
              >
                <span className="text-ink-3">
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
