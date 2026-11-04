import { ChevronDown } from 'lucide-react'
import { Banner, Mono } from '../../components/ui'
import type { IntegrityResult } from './approvalFlow'

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center justify-between gap-2 text-sm ${ok ? 'text-ink' : 'font-medium text-high'}`}>
      <span>{label}</span>
      <span className={ok ? 'font-medium text-low' : ''}>{ok ? '✅ 확인' : '❌ 실패'}</span>
    </li>
  )
}

function CheckDetails({ result, receivedHash }: { result: IntegrityResult; receivedHash: string }) {
  const hashClass = result.hashOk ? 'text-xs' : 'text-xs text-high'
  return (
    <>
      <ul className={`flex flex-col gap-1 rounded-lg px-2.5 py-2 ${result.ok ? 'bg-low-soft/60' : 'bg-high-soft'}`}>
        <CheckRow ok={result.hashOk} label="Plan 해시 일치" />
        <CheckRow ok={result.signatureOk} label="실행기 서명 확인" />
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
 * 받은 Plan으로 다시 계산한 해시와 실행기 서명의 확인 결과.
 * 통과하면 초록 한 줄로 접어 두고, 실패하면 서명할 수 없으므로 전부 보여 준다.
 * awaitingKey: 해시는 맞고 승인 키가 없어 서명만 확인하지 못한 경우. 변조 경고 대신 조용히 알린다.
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
    return <p className="text-sm text-ink-2">실행기 서명은 승인 키를 등록한 뒤 확인합니다.</p>
  }
  if (result.ok) {
    return (
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-base font-medium text-low [&::-webkit-details-marker]:hidden">
          Plan 무결성 확인됨
          <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-2.5 flex flex-col gap-2.5">
          <CheckDetails result={result} receivedHash={receivedHash} />
        </div>
      </details>
    )
  }
  return (
    <div className="flex flex-col gap-2.5">
      <CheckDetails result={result} receivedHash={receivedHash} />
      <Banner tone="danger" title="Plan 무결성 확인 실패">
        {!result.hashOk && '받은 Plan으로 계산한 해시가 실행기가 만든 해시와 다릅니다. '}
        {result.keyMissing
          ? '이 기기에 고정된 실행기 공개키가 없어 실행기 서명을 확인할 수 없습니다. '
          : !result.signatureOk && '실행기 서명이 고정해 둔 공개키로 확인되지 않습니다. '}
        서명하지 말고 관리자에게 알려 주세요.
      </Banner>
    </div>
  )
}
