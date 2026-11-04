import { Cpu } from 'lucide-react'
import type { AuditLog } from '../../api/types'
import { UserChip } from '../../components/rich'

/** 기록을 남긴 주체. 사람이 아닌 실행기는 얼굴 대신 아이콘으로 구분한다. */
export function ActorChip({ actor }: { actor: AuditLog['actor'] }) {
  if (actor.id !== 'system') return <UserChip name={actor.name} />
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-terminal text-terminal-ink">
        <Cpu size={13} />
      </span>
      <span className="text-[0.8125rem] font-medium text-ink">{actor.name}</span>
    </span>
  )
}
