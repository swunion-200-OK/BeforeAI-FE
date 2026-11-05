import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { auditApi } from '../../api/endpoints'
import type { AuditLog, FailedCheck } from '../../api/types'
import { NetworkBadge } from '../../components/badges'
import { Banner, Drawer, ErrorState, Mono, Spinner } from '../../components/ui'
import { AUDIT_DETAIL_LABEL, FAILED_CHECK_LABEL } from '../../lib/labels'
import { useProjects } from '../../lib/queries'
import { AuditActionLabel } from './AuditActionLabel'
import { actorName } from './auditLogView'

const MONO_KEYS = new Set(['keyId', 'planHash', 'documentId'])

const fullDateTime = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function DetailValue({ name, value }: { name: string; value: unknown }) {
  if (typeof value === 'boolean') return <>{value ? '예' : '아니요'}</>
  if (typeof value === 'string' || typeof value === 'number') {
    return MONO_KEYS.has(name) ? <Mono>{String(value)}</Mono> : <>{String(value)}</>
  }
  return (
    <pre className="overflow-x-auto rounded bg-sheet-alt p-2 font-mono text-xs whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

function LogBody({ log }: { log: AuditLog }) {
  const projects = useProjects()
  const projectName = projects.data?.find((project) => project.id === log.target.projectId)?.name
  const { failedChecks, ...rest } = log.detail
  const checks = Array.isArray(failedChecks) ? (failedChecks as FailedCheck[]) : []
  const others = Object.entries(rest).filter(([, value]) => value !== undefined && value !== null)

  return (
    <div className="flex flex-col gap-4">
      {checks.length > 0 && (
        <Banner tone="danger" title="실행 전 검증에 실패한 항목">
          <ul className="mt-1 flex flex-col gap-1.5">
            {checks.map((check) => (
              <li key={check}>
                <Mono className="font-medium">{check}</Mono>
                <br />
                {FAILED_CHECK_LABEL[check] ?? check}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
        <Row label="시각">{Number.isNaN(Date.parse(log.at)) ? '-' : fullDateTime.format(new Date(log.at))}</Row>
        <Row label="사용자">{actorName(log)}</Row>
        <Row label="액션">
          <AuditActionLabel action={log.action} />
        </Row>
        {log.network && (
          <Row label="접속 환경">
            <NetworkBadge network={log.network} />
          </Row>
        )}
        {log.ip && (
          <Row label="IP">
            <Mono>{log.ip}</Mono>
          </Row>
        )}
        {log.target.requestId && (
          <Row label="요청">
            <Link to={`/requests/${log.target.requestId}`} className="font-medium text-seal hover:underline">
              요청 상세 열기
            </Link>{' '}
            <Mono className="text-ink-3">{log.target.requestId}</Mono>
          </Row>
        )}
        {log.target.taskIds && log.target.taskIds.length > 0 && (
          <Row label="작업">
            <Mono>{log.target.taskIds.join(', ')}</Mono>
          </Row>
        )}
        {log.target.projectId && <Row label="프로젝트">{projectName ?? log.target.projectId}</Row>}
        {log.target.label && <Row label="대상">{log.target.label}</Row>}
        {others.map(([key, value]) => (
          <Row key={key} label={AUDIT_DETAIL_LABEL[key] ?? key}>
            <DetailValue name={key} value={value} />
          </Row>
        ))}
      </dl>
    </div>
  )
}

export function AuditDetailDrawer({ logId, onClose }: { logId: string | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['audit-log', logId],
    queryFn: () => auditApi.get(logId as string),
    enabled: Boolean(logId),
  })
  return (
    <Drawer open={Boolean(logId)} title="감사 로그 상세" onClose={onClose}>
      {query.isPending && <Spinner />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data && <LogBody log={query.data} />}
    </Drawer>
  )
}
