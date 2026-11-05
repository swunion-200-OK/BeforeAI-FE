import { BrandMark } from '../../components/BrandMark'
import type { ReactNode } from 'react'
import loginStamp from '../../assets/login-stamp.webp'
import { useNetwork } from '../../lib/queries'

/** 왼쪽 문서는 장식이다. 실제 승인 데이터나 절차와 아무 관련이 없다. */
const DOCUMENT_FIELDS = [
  { label: '문서번호', value: '개발-2026-0412' },
  { label: '기안일자', value: '2026-11-03' },
  { label: '기안부서', value: '개발본부 백엔드팀' },
]

/** 사람 손으로 찍은 것처럼 칸마다 각도, 위치, 진하기가 조금씩 다르다. */
const APPROVAL_LINE = [
  { step: '기안', name: '홍길동', seed: 3, tilt: -7, shiftX: -2, shiftY: 1, ink: 1 },
  { step: '검토', name: '김담당', seed: 11, tilt: 5, shiftX: 3, shiftY: -2, ink: 0.72 },
  { step: '승인', name: '최팀장', seed: 23, tilt: -3, shiftX: 1, shiftY: 2, ink: 0.94 },
]

const FORM_RULE = 'border-[#55524a]'
const FORM_LABEL = 'bg-[#efebe0] font-medium'

/** 이름 도장. 이름을 세로로 새기고, 인주가 고르게 묻지 않은 모양을 필터로 낸다. */
function NameSeal({ name, seed, tilt, shiftX, shiftY, ink }: (typeof APPROVAL_LINE)[number]) {
  const filterId = `name-seal-ink-${seed}`
  return (
    <svg
      viewBox="0 0 44 44"
      className="size-[2.75rem] mix-blend-multiply"
      style={{ opacity: ink, transform: `translate(${shiftX}px, ${shiftY}px) rotate(${tilt}deg)` }}
    >
      <defs>
        <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed={seed} result="edge" />
          <feDisplacementMap in="SourceGraphic" in2="edge" scale="1.1" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="3" seed={seed + 1} />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4 0 0 0 -0.75" result="patches" />
          <feComposite in="rough" in2="patches" operator="in" result="uneven" />
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed={seed + 2} />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  9 0 0 0 -2.4" result="speckle" />
          <feComposite in="uneven" in2="speckle" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`} fill="#c8321e">
        <circle cx="22" cy="22" r="20" fill="none" stroke="#c8321e" strokeWidth="1.9" />
        {[...name].map((char, index) => (
          <text key={index} x="22" y={14.6 + index * 10.6} textAnchor="middle" fontSize="10.6" fontWeight="600">
            {char}
          </text>
        ))}
      </g>
    </svg>
  )
}

/** 어두운 판 위에 놓인 결재 문서 한 장. 아래쪽은 판 밖으로 나가 잘린다. 낮은 창에서는 제목과 겹치지 않게 숨긴다. */
function ApprovalDocument() {
  return (
    <div
      aria-hidden
      className="-mb-12 w-[calc(100%-3.5rem)] max-w-[34rem] shrink-0 bg-[#f8f6ef] px-7 pt-6 text-xs text-[#26241f] shadow-[1px_1px_1px_rgb(0_0_0/0.35),8px_16px_36px_rgb(0_0_0/0.45)] [@media(max-height:620px)]:hidden"
    >
      <p className="mb-4 text-center text-lg font-semibold tracking-[0.6em] indent-[0.6em]">업무기안</p>

      <div className="flex items-stretch justify-between gap-3">
        <dl className={`grid min-w-0 flex-1 grid-cols-[4.25rem_minmax(0,1fr)] grid-rows-3 border ${FORM_RULE}`}>
          {DOCUMENT_FIELDS.map(({ label, value }, index) => (
            <div key={label} className={`col-span-2 grid grid-cols-subgrid ${index > 0 ? `border-t ${FORM_RULE}` : ''}`}>
              <dt className={`flex items-center justify-center border-r ${FORM_RULE} ${FORM_LABEL}`}>{label}</dt>
              <dd className="flex items-center truncate px-2 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className={`flex shrink-0 border ${FORM_RULE}`}>
          <div className={`flex w-6 flex-col items-center justify-center gap-2 border-r ${FORM_RULE} ${FORM_LABEL}`}>
            <span>결</span>
            <span>재</span>
          </div>
          {APPROVAL_LINE.map((seal) => (
            <div key={seal.step} className={`w-[3.25rem] border-r last:border-r-0 ${FORM_RULE}`}>
              <div className={`border-b py-1 text-center ${FORM_RULE} ${FORM_LABEL}`}>{seal.step}</div>
              <div className="relative flex h-[3.625rem] items-center justify-center">
                <NameSeal {...seal} />
                {/* 방금 찍고 든 도장. 고무면이 승인 도장 오른쪽 위에 온다. 움직이지 않는 그림이다 */}
                {seal.step === '승인' && (
                  <img
                    src={loginStamp}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute top-1/2 left-1/2 z-10 -mt-[226px] -ml-[20px] w-[260px] max-w-none select-none"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`mt-3 grid grid-cols-[4.25rem_minmax(0,1fr)] border ${FORM_RULE}`}>
        <div className={`flex items-center justify-center border-r py-1.5 ${FORM_RULE} ${FORM_LABEL}`}>제목</div>
        <div className="truncate px-2 py-1.5 font-medium">auth-service 스테이징 배포 승인 요청</div>
      </div>
      {/* 본문 칸은 판 밖으로 이어져 잘린다 */}
      <div className={`h-40 border-x ${FORM_RULE}`} />
    </div>
  )
}

function BrandPanel() {
  return (
    <aside className="flex min-w-0 flex-1 flex-col overflow-hidden bg-login-panel px-[clamp(3.5rem,5.6vw,5.3rem)] pt-[clamp(2.5rem,6.8vh,4rem)] max-lg:hidden">
      <p className="flex items-baseline gap-2.5 text-2xl font-bold tracking-tight text-white">
        <BrandMark height={28} className="text-white" />
        BeforeAI
      </p>
      <div className="flex min-h-0 flex-1 items-center py-8">
        <h2 className="text-[clamp(3rem,4.25vw,3.75rem)] leading-[1.2] font-bold tracking-tight text-white">
          AI 작업,
          <br />
          승인받고 실행합니다
        </h2>
      </div>
      <ApprovalDocument />
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
