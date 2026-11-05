const clockTime = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** 읽기 쉽게 "오늘 14:30", "어제 09:05", "11월 3일 15:28"로 쓴다. 다른 해면 연도를 붙인다. */
export function formatDateTime(iso: string, now = new Date()): string {
  const date = new Date(iso)
  // 시각이 없거나 잘못되면 Intl이 RangeError를 던져 화면 전체가 깨진다.
  if (Number.isNaN(date.getTime())) return '-'
  const clock = clockTime.format(date)
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (daysAgo === 0) return `오늘 ${clock}`
  if (daysAgo === 1) return `어제 ${clock}`
  const monthDay = `${date.getMonth() + 1}월 ${date.getDate()}일 ${clock}`
  return date.getFullYear() === now.getFullYear() ? monthDay : `${date.getFullYear()}년 ${monthDay}`
}

/** "3시간 12분", "2일 4시간"처럼 경과 시간을 짧게 쓴다. */
export function formatElapsed(iso: string, now = Date.now()): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return '-'
  const minutes = Math.max(0, Math.floor((now - time) / 60_000))
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
