import { Stamp } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNetwork } from '../../lib/queries'

/** 왼쪽은 로고, 제목, 도장 셋뿐이다. 시선은 오른쪽 폼으로 가야 한다. */
function BrandPanel() {
  return (
    <aside className="flex flex-1 flex-col bg-nav px-20 py-16">
      <p className="flex items-center gap-3.5 text-2xl font-bold tracking-tight text-white">
        <span className="inline-flex size-12 items-center justify-center rounded-xl bg-seal">
          <Stamp size={26} aria-hidden />
        </span>
        AI 작업 승인
      </p>
      <div className="flex flex-1 flex-col justify-center gap-14">
        <h2 className="text-[3.75rem] leading-[1.2] font-bold tracking-tight text-white">
          AI 작업,
          <br />
          승인받고 실행합니다
        </h2>
        <span
          aria-hidden
          className="inline-flex size-48 -rotate-6 items-center justify-center rounded-full bg-seal text-white outline-4 outline-offset-[6px] outline-seal"
        >
          <span className="text-[3.25rem] font-bold tracking-tight">승인</span>
        </span>
      </div>
    </aside>
  )
}

/** 로그인 전 화면의 틀. 왼쪽은 브랜드, 오른쪽은 폼이다. 화면을 반씩 쓴다. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const network = useNetwork()
  return (
    <div className="flex h-dvh flex-col bg-paper">
      <div className={`h-1 shrink-0 ${network === 'EXTERNAL' ? 'band-external' : 'bg-internal'}`} role="presentation" />
      <div className="flex min-h-0 flex-1">
        <BrandPanel />
        <main className="quiet-scroll flex min-w-0 flex-1 flex-col items-center overflow-y-auto px-10 py-8">
          {/* 내용이 길면 위가 잘리지 않게 margin으로 가운데 맞춘다 */}
          <div className="my-auto flex w-full max-w-[34rem] flex-col gap-5">{children}</div>
        </main>
      </div>
    </div>
  )
}
