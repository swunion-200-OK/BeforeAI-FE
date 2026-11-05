import { useEffect, useRef, useState } from 'react'
import type { GatePhase, GateView } from './progressStatus'

const STEP_MS = 150

/**
 * 지켜보는 동안 관문을 지나가면 검사를 하나씩 켠다. 결과는 이미 나와 있고 보여 주는 순서만 늦춘다.
 * 페이지를 열 때의 상태는 다시 재생하지 않는다. 돌려주는 값은 지금까지 켠 검사 수이고, 끝나면 null이다.
 */
export function useGateReplay(gate: GateView | null, fetching: boolean): number | null {
  const [lit, setLit] = useState<number | null>(null)
  const previous = useRef<GatePhase | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const phase = gate?.phase ?? null
  const firstFailed = gate?.checks.findIndex((check) => check.state === 'failed') ?? -1
  // 실패면 첫 실패 칸까지만 켠 뒤 관문을 닫는다.
  const count = firstFailed === -1 ? (gate?.checks.length ?? 0) : firstFailed + 1

  useEffect(() => () => clearInterval(timer.current), [])

  useEffect(() => {
    if (!phase) return
    // 처음 읽은 값이 오래된 캐시일 수 있다. 새로 받은 뒤의 상태를 출발점으로 삼는다.
    if (previous.current === null && fetching) return
    const before = previous.current
    previous.current = phase
    const crossed = before === 'waiting' && (phase === 'passed' || phase === 'failed')
    if (!crossed || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let shown = 0
    setLit(0)
    clearInterval(timer.current)
    timer.current = setInterval(() => {
      shown += 1
      if (shown > count) {
        clearInterval(timer.current)
        setLit(null)
      } else {
        setLit(shown)
      }
    }, STEP_MS)
    // 폴링으로 fetching이 바뀌어도 켜는 중인 장면은 멈추지 않는다.
  }, [phase, fetching, count])

  return lit
}
