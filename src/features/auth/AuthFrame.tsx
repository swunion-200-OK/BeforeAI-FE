import type { ReactNode } from 'react'
import { useNetwork } from '../../lib/queries'

/** 왼쪽 판의 장식이다. 실제 승인 데이터나 절차와 아무 관련이 없다. */
const APPROVAL_LINE = [
  { role: '요청', seal: '요청', tilt: '-rotate-6', lands: false },
  { role: '담당자', seal: '승인', tilt: 'rotate-3', lands: false },
  { role: '관리자', seal: '승인', tilt: '-rotate-[8deg]', lands: true },
]

/** 옆에서 본 도장. 찍는 면이 자국 크기와 맞도록 아래가 살짝 넓다. 움직임은 index.css의 login-tool이 맡는다. */
function StampTool() {
  return (
    <svg
      viewBox="0 0 72 92"
      width="72"
      height="92"
      className="login-tool pointer-events-none absolute bottom-0 left-1/2 z-10 -ml-9 max-w-none"
    >
      <path d="M12 16C12 7 23 2 36 2s24 5 24 14v54c0 6 6 8 10 12v6H2v-6c4-4 10-6 10-12Z" fill="#6b3d24" />
      <path d="M46 3.5C54 5.5 60 10 60 16v54c0 6 6 8 10 12v6H46Z" fill="#54301c" />
      <rect x="19" y="16" width="4" height="48" rx="2" fill="#8f5f40" />
      <rect x="2" y="88" width="68" height="4" fill="#c8321e" />
    </svg>
  )
}

/** 어두운 판 위에 놓인 승인 문서 한 장. 아래쪽은 판 밖으로 나가 잘린다. 낮은 창에서는 제목과 겹치지 않게 숨긴다. */
function ApprovalPaper() {
  return (
    <div
      aria-hidden
      className="login-paper -mb-12 w-full max-w-[34rem] shrink-0 -rotate-2 bg-sheet px-7 pt-6 pb-44 text-ink shadow-[0_24px_60px_rgb(0_0_0/0.45)] [@media(max-height:620px)]:hidden"
    >
      <p className="text-sm font-medium text-ink-3">작업 승인 문서</p>
      <p className="mt-0.5 mb-4 text-2xl font-bold tracking-[-0.02em]">스테이징 배포</p>
      <div className="flex border border-ink-3">
        {APPROVAL_LINE.map(({ role, seal, tilt, lands }) => (
          <div key={role} className="min-w-0 flex-1 border-r border-ink-3 last:border-r-0">
            <div className="border-b border-ink-3 py-1.5 text-center text-sm font-semibold text-ink-2">{role}</div>
            <div className="flex h-[6.5rem] items-center justify-center">
              <span className="relative inline-flex">
                <span
                  className={`inline-flex size-[4.5rem] items-center justify-center rounded-full border-[3px] border-stamp text-stamp ${tilt} ${
                    lands ? 'login-mark' : ''
                  }`}
                >
                  <span className="text-lg font-bold tracking-tight">{seal}</span>
                </span>
                {lands && <StampTool />}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BrandPanel() {
  return (
    <aside className="flex min-w-0 flex-1 flex-col overflow-hidden bg-login-panel px-[clamp(3.5rem,5.6vw,5.3rem)] pt-[clamp(2.5rem,6.8vh,4rem)] max-lg:hidden">
      <p className="text-2xl font-bold tracking-tight text-white">AI 작업 승인</p>
      <div className="flex min-h-0 flex-1 items-center py-8">
        <h2 className="text-[clamp(3rem,4.25vw,3.75rem)] leading-[1.2] font-bold tracking-tight text-white">
          AI 작업,
          <br />
          승인받고 실행합니다
        </h2>
      </div>
      <ApprovalPaper />
    </aside>
  )
}

/** 로그인 전 화면의 틀. 왼쪽은 브랜드, 오른쪽은 폼이다. 화면을 반씩 쓴다. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const network = useNetwork()
  return (
    <div className="flex h-dvh flex-col bg-paper">
      {network === 'EXTERNAL' && <div className="band-external h-1 shrink-0" role="presentation" />}
      <div className="flex min-h-0 flex-1">
        <BrandPanel />
        <main className="quiet-scroll flex min-w-0 flex-1 flex-col items-center overflow-y-auto px-10 py-8">
          {/* 내용이 길면 위가 잘리지 않게 margin으로 가운데 맞춘다 */}
          <div className="my-auto flex w-full max-w-[34rem] flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
