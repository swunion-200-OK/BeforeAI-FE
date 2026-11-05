import { Check, ChevronDown, X } from 'lucide-react'
import { Banner, Mono } from '../../components/ui'
import type { IntegrityResult } from './approvalFlow'

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center justify-between gap-2 text-sm ${ok ? 'text-ink' : 'font-medium text-high'}`}>
      <span>{label}</span>
      <span className={`inline-flex items-center gap-1 ${ok ? 'font-medium text-low' : ''}`}>
        {ok ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />}
        {ok ? '확인' : '실패'}
      </span>
    </li>
  )
}

function CheckDetails({ result, receivedHash }: { result: IntegrityResult; receivedHash: string }) {
  const hashClass = result.hashOk ? 'text-xs' : 'text-xs text-high'
  return (
    <>
      <ul className="flex flex-col gap-1">
        <CheckRow ok={result.hashOk} label="Plan 해시 일치" />
        <CheckRow ok={result.displayOk} label="화면 내용 일치" />
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-2">
        <dt className="text-ink-3">계산값</dt>
        <dd>
          <Mono className={hashClass}>{result.computedHash}</Mono>
        </dd>
        <dt className="text-ink-3">받은값</dt>
        <dd>
          <Mono className={hashClass}>{receivedHash}</Mono>
        </dd>
      </dl>
    </>
  )
}

/**
 * hashTarget으로 다시 계산한 해시와, 화면의 Plan과 hashTarget이 같은 내용인지의 확인 결과.
 * 통과하면 초록 한 줄로 접어 두고, 실패하면 서명할 수 없으므로 전부 보여 준다.
 * awaitingKey: 내용은 맞고 승인 키가 아직 없어 서명만 못 하는 경우. 변조 경고 대신 조용히 알린다.
 */
export function IntegrityCheck({
  result,
  receivedHash,
  awaitingKey = false,
}: {
  result: IntegrityResult
  receivedHash: string
  awaitingKey?: boolean
}) {
  if (awaitingKey) {
    return <p className="text-sm text-ink-2">Plan 내용은 확인했습니다. 서명은 승인 키를 등록한 뒤 할 수 있습니다.</p>
  }
  if (result.ok) {
    return (
      <details data-integrity-check className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
          <Check size={16} className="shrink-0 text-low" aria-hidden />
          <span className="flex-1">Plan 무결성 확인됨</span>
          <ChevronDown size={14} className="shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-2.5 flex flex-col gap-2.5">
          <CheckDetails result={result} receivedHash={receivedHash} />
        </div>
      </details>
    )
  }
  return (
    <div data-integrity-check className="flex flex-col gap-2.5">
      <CheckDetails result={result} receivedHash={receivedHash} />
      <Banner tone="danger" title="Plan 무결성 확인 실패">
        {!result.hashOk && '받은 내용으로 직접 계산한 해시가 웹 서비스가 보낸 해시와 다릅니다. '}
        {!result.displayOk && '화면에 보이는 Plan이 실제로 서명할 내용과 다릅니다. '}
        {result.keyMissing && '이 기기에 고정된 웹쉘 공개키가 없어 승인 서명을 암호화할 수 없습니다. '}
        서명하지 말고 관리자에게 알려 주세요.
      </Banner>
    </div>
  )
}
