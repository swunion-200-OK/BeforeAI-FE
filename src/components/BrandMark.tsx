/** 로고 마크. favicon과 같은 모양이고, 색은 놓이는 바탕에 맞춰 글자색을 따른다. */
export function BrandMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 48 48" width={size} height={size} fill="none" stroke="currentColor" className={`shrink-0 ${className}`}>
      <circle cx="24" cy="24" r="21" strokeWidth="4" />
      <circle cx="24" cy="24" r="15" strokeWidth="2" />
      <path d="M16 24.5l5.5 5.5L32.5 18" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
