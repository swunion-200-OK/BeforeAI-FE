import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { Link } from 'react-router'
import { networkStore } from '../../api/client'
import { approvalsApi } from '../../api/endpoints'
import { devControls } from '../../api/mock'
import type { TamperAttack } from '../../api/mock/store'
import { useAuth } from '../../app/AuthProvider'
import { Button, Mono, Spinner } from '../../components/ui'
import { useRequest } from '../../lib/queries'
import { ApprovalDetail } from '../approvals/ApprovalDetail'
import { verifyIntegrity } from '../approvals/approvalFlow'
import { describeOutcome, type OutcomeTone, type TamperOutcome } from './tamperOutcome'

const APPROVER_ID = 'u-07'

/** 각 공격을 막는 방어의 위치. 앞의 둘은 승인자 기기, 뒤의 둘은 웹쉘이다. */
const DEFENSE: Record<TamperAttack, string> = {
  SWAP_BEFORE_SIGN: '[data-integrity-check]',
  SWAP_DISPLAY: '[data-integrity-check]',
  SWAP_AFTER_SIGN: '[aria-label="웹쉘 검증 관문"]',
  FORGE_APPROVAL: '[aria-label="웹쉘 검증 관문"]',
}
/** 결과가 나온 뒤 배너가 붙어 자리가 밀리는 동안만 따라간다. */
const FOLLOW_LAYOUT_MS = 2500

/** 공격 결과가 나오면 막은 방어를 승인자 화면 안에서 보여 준다. 공격자 패널은 함께 움직이지 않는다. */
function useRevealDefense(region: RefObject<HTMLElement | null>, attack: TamperAttack | null, settled: boolean) {
  useEffect(() => {
    const root = region.current
    if (!root || !attack || !settled) return
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    let placed: HTMLElement | null = null
    let placedAt = ''
    const reveal = () => {
      const target = root.querySelector<HTMLElement>(DEFENSE[attack])
      const position = `${target?.offsetTop}:${target?.offsetHeight}`
      if (!target || (target === placed && position === placedAt)) return
      placed = target
      placedAt = position
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior })
    }
    reveal()
    const observer = new MutationObserver(reveal)
    observer.observe(root, { childList: true, subtree: true })
    const stop = setTimeout(() => observer.disconnect(), FOLLOW_LAYOUT_MS)
    return () => {
      clearTimeout(stop)
      observer.disconnect()
    }
  }, [region, attack, settled])
}

const ATTACKS: Array<{ id: TamperAttack; label: string; run: (requestId: string) => void }> = [
  { id: 'SWAP_BEFORE_SIGN', label: '서명 전에 배포 대상을 production으로 바꿔치기', run: devControls.tamper.swapBeforeSigning },
  { id: 'SWAP_DISPLAY', label: '화면에 보이는 Plan만 바꿔치기', run: devControls.tamper.swapDisplayOnly },
  { id: 'SWAP_AFTER_SIGN', label: '서명한 뒤 실행 직전에 Plan 바꿔치기', run: devControls.tamper.armSwapAfterSigning },
  { id: 'FORGE_APPROVAL', label: '서명 없이 승인을 지어내기', run: devControls.tamper.forgeApproval },
]

const TONE: Record<OutcomeTone, { box: string; label: string }> = {
  caught: { box: 'border-low text-low', label: '막혔습니다' },
  waiting: { box: 'border-medium text-medium', label: '걸어 두었습니다' },
  missed: { box: 'border-high text-high', label: '막지 못했습니다' },
  unverified: { box: 'border-forbidden text-forbidden', label: '검증되지 않았습니다' },
}

function OutcomeNote({ outcome }: { outcome: TamperOutcome | null }) {
  if (!outcome) {
    return <p className="mt-2 px-1 text-sm text-ink-3">확인하는 중입니다</p>
  }
  const tone = TONE[outcome.tone]
  return (
    <div role="status" data-tone={outcome.tone} className={`mt-2.5 border-l-[3px] py-0.5 pl-4 ${tone.box}`}>
      <p className="text-[1.375rem] leading-snug font-semibold">{tone.label}</p>
      <p className="mt-1 text-base break-keep text-ink">{outcome.sentence}</p>
      {outcome.codes?.map((code) => (
        <Mono key={code} className="mt-1.5 block text-sm">
          {code}
        </Mono>
      ))}
    </div>
  )
}

function AttackerPanel({
  requestId,
  attack,
  approverRegion,
}: {
  requestId: string
  attack: TamperAttack | null
  approverRegion: RefObject<HTMLElement | null>
}) {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const requestQuery = useRequest(requestId)
  const request = requestQuery.data
  // 승인 화면과 같은 승인 자료, 같은 확인 함수로 결과를 읽는다.
  const contextQuery = useQuery({
    queryKey: ['tamper-context', requestId, request?.updatedAt ?? null],
    queryFn: () => approvalsApi.context(requestId),
    enabled: Boolean(request) && attack !== null && !busy,
  })
  const context = contextQuery.data
  const integrity = useMemo(
    () => (context && request ? verifyIntegrity(context, APPROVER_ID, request.projectId) : undefined),
    [context, request],
  )

  // 공격 직후의 옛 응답으로 "막지 못했다"고 말하면 안 되므로, 새로 받기 전에는 결과를 내지 않는다.
  const outcome = attack && request && !busy ? describeOutcome(attack, { request, context, integrity, contextFailed: contextQuery.isError }) : null
  useRevealDefense(approverRegion, attack, outcome?.tone === 'caught' || outcome?.tone === 'missed')
  const untouched = !attack && request?.status === 'PENDING_APPROVAL' && request.approvalStatus.every((s) => s.requirements.every((r) => r.approvedBy.length === 0))

  const refresh = async (work: () => unknown) => {
    setBusy(true)
    work()
    await client.invalidateQueries()
    setBusy(false)
  }

  return (
    <section aria-label="공격자 패널" className="quiet-scroll flex w-[22rem] shrink-0 flex-col overflow-y-auto border-r border-rule bg-sheet">
      <header className="border-t-4 border-high px-6 pt-6 pb-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-high">공격자</p>
          <Link to="/" className="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink hover:underline">
            <ArrowLeft size={15} aria-hidden />
            시연 나가기
          </Link>
        </div>
        <h1 className="mt-1 text-[1.625rem] leading-snug font-semibold tracking-[-0.02em] break-keep">웹 서비스가 뚫렸다고 가정합니다</h1>
      </header>
      <ol className="flex flex-col gap-3 px-6">
        {ATTACKS.map((item, index) => {
          const active = attack === item.id
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={!untouched || busy}
                aria-pressed={active}
                onClick={() => refresh(() => item.run(requestId))}
                className={`flex w-full items-start gap-3 rounded-md border px-4 py-3.5 text-left text-[1.0625rem] leading-snug font-semibold break-keep transition-colors ${
                  active
                    ? 'border-high text-ink ring-1 ring-high'
                    : untouched
                      ? 'border-rule-strong text-ink hover:border-high hover:bg-sheet-alt'
                      : 'cursor-not-allowed border-rule text-ink-3'
                }`}
              >
                <span aria-hidden className="text-ink-3 tabular-nums">
                  {index + 1}
                </span>
                <span>{item.label}</span>
              </button>
              {active && <OutcomeNote outcome={outcome} />}
            </li>
          )
        })}
      </ol>
      <div className="mt-auto px-6 pt-6 pb-6">
        <Button
          variant={attack ? 'primary' : 'secondary'}
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => refresh(() => devControls.tamper.reset())}
        >
          처음부터
        </Button>
      </div>
    </section>
  )
}

/** 변조 시연. 왼쪽에서 공격하면 오른쪽의 실제 승인 화면과 진행 상황 트리가 바로 반응한다. 목 빌드에만 들어간다. */
export default function TamperDemoPage() {
  const { me, signIn } = useAuth()
  const client = useQueryClient()
  const requestId = useSyncExternalStore(devControls.subscribe, devControls.tamper.currentId)
  const attack = useSyncExternalStore(devControls.subscribe, () => devControls.tamper.attackOf(requestId))
  const approverRegion = useRef<HTMLElement>(null)

  // 시연은 내부망의 김담당 화면으로 한다. 외부망이면 배포 작업에 서명할 수 없다.
  useEffect(() => {
    if (devControls.state().network !== 'INTERNAL') {
      devControls.setNetwork('INTERNAL')
      networkStore.set('INTERNAL')
      void client.invalidateQueries()
    }
    if (me && me.id !== APPROVER_ID) void signIn(devControls.switchUser(APPROVER_ID))
  }, [client, me, signIn])

  // 시연 요청은 이 화면을 여는 동안에만 있다. 없으면 만든다.
  useEffect(() => {
    if (!requestId) devControls.tamper.ensure()
  }, [requestId])

  if (!requestId || me?.id !== APPROVER_ID) return <Spinner label="시연을 준비하는 중" />

  return (
    <div className="flex h-dvh min-h-0">
      <AttackerPanel key={requestId} requestId={requestId} attack={attack} approverRegion={approverRegion} />
      <section ref={approverRegion} aria-label="승인자 화면" className="flex min-w-0 flex-1 flex-col">
        <p className="shrink-0 border-b border-rule bg-sheet-alt px-7 py-2 text-sm font-semibold text-ink-2">승인자 김담당의 실제 화면</p>
        <div className="flex min-h-0 flex-1">
          <ApprovalDetail key={requestId} requestId={requestId} progressDefaultOpen />
        </div>
      </section>
    </div>
  )
}
