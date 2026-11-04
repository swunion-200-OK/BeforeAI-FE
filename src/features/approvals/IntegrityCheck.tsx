import { Banner, Mono } from '../../components/ui'
import { shortHash } from '../../lib/format'
import type { IntegrityResult } from './approvalFlow'

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center justify-between gap-2 text-sm ${ok ? 'text-ink' : 'font-medium text-high'}`}>
      <span>{label}</span>
      <span>{ok ? '✅ 확인' : '❌ 실패'}</span>
    </li>
  )
}

/** 받은 Plan으로 다시 계산한 해시와 실행기 서명의 확인 결과. 실패하면 서명할 수 없다. */
export function IntegrityCheck({ result, receivedHash }: { result: IntegrityResult; receivedHash: string }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        <CheckRow ok={result.hashOk} label="Plan 해시 일치" />
        <CheckRow ok={result.signatureOk} label="실행기 서명 확인" />
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-2">
        <dt className="text-ink-3">계산값</dt>
        <dd title={result.computedHash}>
          <Mono className={result.hashOk ? 'text-xs' : 'text-xs text-high'}>
            {result.hashOk ? shortHash(result.computedHash) : result.computedHash}
          </Mono>
        </dd>
        <dt className="text-ink-3">받은값</dt>
        <dd title={receivedHash}>
          <Mono className={result.hashOk ? 'text-xs' : 'text-xs text-high'}>
            {result.hashOk ? shortHash(receivedHash) : receivedHash}
          </Mono>
        </dd>
      </dl>
      {!result.ok && (
        <Banner tone="danger" title="Plan 무결성 확인 실패">
          {!result.hashOk && '받은 Plan으로 계산한 해시가 실행기가 만든 해시와 다릅니다. '}
          {result.keyMissing
            ? '이 기기에 고정된 실행기 공개키가 없어 실행기 서명을 확인할 수 없습니다. '
            : !result.signatureOk && '실행기 서명이 고정해 둔 공개키로 확인되지 않습니다. '}
          서명하지 말고 관리자에게 알려 주세요.
        </Banner>
      )}
    </div>
  )
}
