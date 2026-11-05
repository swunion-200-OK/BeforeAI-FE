/** 로고의 도장 마크. 모양은 그림 파일에서 가져오고 색은 글자색을 따른다. */
export function BrandMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  const mask = 'url(/logo-mark.png) center / contain no-repeat'
  return <span aria-hidden className={`inline-block shrink-0 bg-current ${className}`} style={{ width: size, height: size, mask, WebkitMask: mask }} />
}
