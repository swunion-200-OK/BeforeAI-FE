import { useQuery } from '@tanstack/react-query'
import { BookText, History, Lock, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import { forbiddenApi, orgApi, requestsApi } from '../../api/endpoints'
import type { Risk } from '../../api/types'
import { RequestStatusBadge, RiskBadge } from '../../components/badges'
import { AvatarStack, KeyValues } from '../../components/rich'
import { Mono, Sheet, Spinner } from '../../components/ui'
import { formatElapsed } from '../../lib/format'
import { RULE_LABEL, TASK_TYPE_LABEL } from '../../lib/labels'
import { useDepartmentNames, useIsExternal, useProjects } from '../../lib/queries'
import { pathFor } from './requestPaths'

/** 어떤 프로젝트에 요청하는지: 담당자, 기준 커밋, 금지 규칙 */
export function ProjectSummaryCard({ projectId }: { projectId: string }) {
  const projects = useProjects()
  const departmentName = useDepartmentNames()
  const project = projects.data?.find((item) => item.id === projectId)
  const departmentId = project?.departmentId
  const rules = useQuery({
    queryKey: ['forbidden-rules', departmentId],
    queryFn: async () => (await forbiddenApi.rules(departmentId as string)).items,
    enabled: Boolean(departmentId),
  })
  if (!project) return null
  const active = rules.data ?? []
  return (
    <Sheet title={project.name} icon={<BookText size={15} aria-hidden />}>
      <KeyValues
        items={[
          { label: '담당 부서', value: departmentName(project.departmentId) },
          {
            label: '담당자',
            value: (
              <span className="inline-flex flex-wrap items-center gap-2">
                <AvatarStack names={project.owners.map((owner) => owner.name)} />
                {project.owners.map((owner) => owner.name).join(', ')}
              </span>
            ),
          },
          { label: '기준 커밋', value: <Mono>{project.baseCommit}</Mono> },
          { label: '저장소', value: <Mono>{project.repository}</Mono> },
          { label: '금지 규칙', value: `${active.length}개` },
        ]}
      />
      {active.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-1.5 border-t border-rule pt-2.5">
          {active.map((rule) => (
            <li key={rule.id} className="flex items-start gap-1.5 text-[0.8125rem] text-ink-2">
              <Lock size={13} className="mt-0.5 shrink-0 text-forbidden" aria-hidden />
              {rule.reason}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

const RISK_ORDER: Array<Exclude<Risk, 'FORBIDDEN'>> = ['LOW', 'MEDIUM', 'HIGH']

/** 위험도별로 누가 승인하는지 (기능 명세서 5.2). AI는 위험도를 올리기만 한다. */
export function ApprovalBasicsCard() {
  const matrix = useQuery({ queryKey: ['approval-matrix'], queryFn: orgApi.approvalMatrix, staleTime: 30_000 })
  return (
    <Sheet title="누가 승인하나요" icon={<ShieldCheck size={15} aria-hidden />}>
      {matrix.isPending && <Spinner />}
      {matrix.data && (
        <ul className="flex flex-col gap-2.5">
          {RISK_ORDER.map((risk) => {
            const rows = matrix.data.filter((row) => row.defaultRisk === risk)
            if (rows.length === 0) return null
            const approvers = [...new Set(rows.map((row) => RULE_LABEL[row.approverRule]))].join(', ')
            return (
              <li key={risk} className="flex items-start gap-2.5">
                <RiskBadge risk={risk} />
                <div className="min-w-0 text-[0.8125rem] leading-snug">
                  <p className="font-medium text-ink">{approvers}</p>
                  <p className="text-xs text-ink-3">{rows.map((row) => TASK_TYPE_LABEL[row.taskType]).join(', ')}</p>
                </div>
              </li>
            )
          })}
          <li className="flex items-start gap-2.5">
            <RiskBadge risk="FORBIDDEN" />
            <p className="text-[0.8125rem] leading-snug font-medium text-ink">승인 불가 (실행 차단)</p>
          </li>
        </ul>
      )}
      <p className="mt-2.5 border-t border-rule pt-2.5 text-xs text-ink-3">
        AI가 내용을 보고 위험도를 올릴 수 있지만 내리지는 못합니다. 필요한 승인 인원은 회사 규모 정책에 따라 달라집니다.
      </p>
    </Sheet>
  )
}

export function RecentRequestsCard() {
  const external = useIsExternal()
  const recent = useQuery({
    queryKey: ['requests', 'recent-mine'],
    queryFn: async () => (await requestsApi.list({ mine: true, limit: 5 })).items,
  })
  return (
    <Sheet
      title="최근 내 요청"
      icon={<History size={15} aria-hidden />}
      flush
      actions={
        <Link to="/requests" className="text-[0.8125rem] font-medium text-seal hover:underline">
          전체 보기
        </Link>
      }
    >
      {recent.isPending && <Spinner />}
      {recent.data?.length === 0 && <p className="px-4 py-3 text-[0.8125rem] text-ink-3">아직 요청이 없습니다.</p>}
      <ul className="divide-y divide-rule">
        {recent.data?.map((request) => (
          <li key={request.id}>
            <Link to={pathFor(request, external)} className="block px-4 py-2 hover:bg-seal-soft/40">
              <span className="block truncate text-[0.8125rem] font-medium text-ink">{request.prompt}</span>
              <span className="mt-1 flex items-center justify-between gap-2">
                <RequestStatusBadge status={request.status} />
                <span className="text-xs text-ink-3">{formatElapsed(request.createdAt)} 전</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
