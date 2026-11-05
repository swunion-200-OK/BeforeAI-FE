import type { AuditLog } from '../../api/types'

/** 웹쉘 이벤트처럼 사람이 아닌 행위는 서버가 actor를 주지 않는다. */
export function actorName(log: Pick<AuditLog, 'actor'>): string {
  return log.actor?.name ?? '시스템'
}

/** 필터에 고를 사용자. 행위자 없는 기록은 고를 수 없어 뺀다. */
export function actorOptions(logs: Array<Pick<AuditLog, 'actor'>>): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>()
  for (const { actor } of logs) if (actor) seen.set(actor.id, actor.name)
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}
