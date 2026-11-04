const dateTime = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso))
}

/** "3시간 12분", "2일 4시간"처럼 경과 시간을 짧게 쓴다. */
export function formatElapsed(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours}시간 ${minutes % 60}분` : `${hours}시간`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days}일 ${hours % 24}시간` : `${days}일`
}

export function shortHash(hash: string | null | undefined, length = 12): string {
  if (!hash) return '-'
  const value = hash.replace(/^sha256:/, '')
  return `sha256:${value.slice(0, length)}…`
}
