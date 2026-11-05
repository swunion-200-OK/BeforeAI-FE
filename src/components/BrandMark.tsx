const ASPECT = 266 / 192

/** 로고의 도장 마크. 그림에 여백이 없어 아래 끝이 이름의 글자 바닥선과 맞는다. 색은 글자색을 따른다. */
export function BrandMark({ height = 22, className = '' }: { height?: number; className?: string }) {
  const mask = 'url(/logo-mark.png) center / contain no-repeat'
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{ width: Math.round(height * ASPECT), height, mask, WebkitMask: mask }}
    />
  )
}
