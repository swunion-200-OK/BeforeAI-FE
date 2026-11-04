import { useQueries, useQuery } from '@tanstack/react-query'
import { BookText, FolderGit2, GitCommitHorizontal, Info, MessageSquarePlus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { documentsApi, projectsApi, requestsApi } from '../../api/endpoints'
import type { Me, Project } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { AvatarStack, KeyValues, StatCard, UserChip } from '../../components/rich'
import { Button, EmptyState, ErrorState, Mono, PageHeader, Sheet, Spinner, Tabs } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { useDepartmentNames, useProjects } from '../../lib/queries'
import { OwnersPanel } from './OwnersPanel'
import { changeRequestsQuery, specQuery } from './queries'
import { ChangeRequestsTab, SpecTab, VersionsTab } from './SpecTabs'

function canEditSpec(me: Me, project: Project): boolean {
  return me.role === 'ADMIN' || (me.role === 'DEPT_MANAGER' && me.departmentId === project.departmentId)
}

function CardFigure({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="px-3 py-2">
      <p className="text-base font-bold tabular-nums">{value ?? '-'}</p>
      <p className="text-xs text-ink-3">{label}</p>
    </div>
  )
}

function ProjectCard({
  project,
  specLabel,
  openRequests,
  requestLabel,
  requestCount,
  pendingCount,
  documentCount,
}: {
  project: Project
  specLabel?: string
  openRequests?: number
  requestLabel: string
  requestCount?: number
  pendingCount?: number
  documentCount?: number
}) {
  const departmentName = useDepartmentNames()
  return (
    <article className="relative flex flex-col gap-3 rounded-xl border border-rule bg-sheet p-4 shadow-card transition-colors hover:border-seal/50 hover:bg-seal-soft/20">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-seal-soft text-seal">
          <FolderGit2 size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">
            {/* 카드 전체가 눌리도록 링크를 넓힌다 */}
            <Link to={`/projects/${project.id}`} className="after:absolute after:inset-0 hover:text-seal">
              {project.name}
            </Link>
          </h2>
          <p className="text-[0.8125rem] text-ink-2">{departmentName(project.departmentId)}</p>
        </div>
        {openRequests !== undefined && openRequests > 0 && (
          <span className="shrink-0 rounded-md bg-medium-soft px-2 py-0.5 text-xs font-medium text-medium">
            수정 요청 {openRequests}건 대기
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 divide-x divide-rule rounded-lg bg-sheet-alt">
        <CardFigure label={requestLabel} value={requestCount} />
        <CardFigure label="승인 대기" value={pendingCount} />
        <CardFigure label="문서" value={documentCount} />
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.8125rem]">
        <dt className="text-ink-3">저장소</dt>
        <dd className="min-w-0 truncate">
          <Mono className="text-ink-2">{project.repository}</Mono>
        </dd>
        <dt className="text-ink-3">기준 커밋</dt>
        <dd className="flex items-center gap-1 text-ink-2">
          <GitCommitHorizontal size={13} className="text-ink-3" aria-hidden />
          <Mono>{project.baseCommit}</Mono>
        </dd>
        <dt className="text-ink-3">기획서</dt>
        <dd className="text-ink-2">{specLabel ?? '불러오는 중'}</dd>
      </dl>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-rule pt-3">
        <span className="min-w-0 truncate text-[0.8125rem] text-ink-2">
          담당 {project.owners.map((owner) => owner.name).join(', ')}
        </span>
        <AvatarStack names={project.owners.map((owner) => owner.name)} />
      </div>
    </article>
  )
}

function ProjectList() {
  const me = useMe()
  const projects = useProjects()
  const list = projects.data ?? []
  const specs = useQueries({ queries: list.map((project) => specQuery(project.id)) })
  const changeRequests = useQueries({ queries: list.map((project) => changeRequestsQuery(project.id)) })
  const documents = useQueries({
    queries: list.map((project) => ({
      queryKey: ['project-documents', project.id],
      queryFn: async () => (await documentsApi.list(project.id)).items,
    })),
  })
  // 역할별 범위로 온다. 직원에게는 본인 요청만 보인다.
  const requests = useQuery({
    queryKey: ['requests', 'by-project'],
    queryFn: async () => (await requestsApi.list({ limit: 100 })).items,
  })
  const requestsOf = (projectId: string) => requests.data?.filter((request) => request.projectId === projectId)

  const openCounts = changeRequests.map((query) => query.data?.filter((item) => item.status === 'OPEN').length)
  const totalOpen = openCounts.reduce<number>((sum, count) => sum + (count ?? 0), 0)
  const ownerCount = new Set(list.flatMap((project) => project.owners.map((owner) => owner.id))).size

  return (
    <>
      <PageHeader title="프로젝트 기획서" description="프로젝트마다 기획서가 하나씩 있습니다. AI 분석과 담당자 지정의 기준이 됩니다." />
      {projects.isPending ? (
        <Spinner />
      ) : projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
      ) : list.length === 0 ? (
        <Sheet>
          <EmptyState title="프로젝트가 없습니다">관리자가 설정에서 프로젝트를 만들면 여기에 나타납니다.</EmptyState>
        </Sheet>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="프로젝트" value={list.length} icon={FolderGit2} tone="seal" />
            <StatCard
              label="처리를 기다리는 수정 요청"
              value={totalOpen}
              icon={MessageSquarePlus}
              tone={totalOpen > 0 ? 'amber' : 'neutral'}
            />
            <StatCard label="지정된 담당자" value={ownerCount} hint="프로젝트마다 2명 이상" icon={Users} tone="live" />
          </div>
          <div className="grid grid-cols-2 gap-4 2xl:grid-cols-3">
            {list.map((project, index) => {
              const spec = specs[index]?.data
              const projectRequests = requestsOf(project.id)
              return (
                <ProjectCard
                  key={project.id}
                  project={project}
                  specLabel={spec ? `v${spec.version}, ${spec.updatedBy.name}, ${formatDateTime(spec.updatedAt)}` : undefined}
                  openRequests={openCounts[index]}
                  requestLabel={me.role === 'EMPLOYEE' ? '내 요청' : '요청'}
                  requestCount={projectRequests?.length}
                  pendingCount={projectRequests?.filter((request) => request.status === 'PENDING_APPROVAL').length}
                  documentCount={documents[index]?.data?.length}
                />
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

type DetailTab = 'spec' | 'versions' | 'requests'

function ProjectDetail({ projectId }: { projectId: string }) {
  const me = useMe()
  const departmentName = useDepartmentNames()
  const [tab, setTab] = useState<DetailTab>('spec')
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => projectsApi.get(projectId) })
  const spec = useQuery(specQuery(projectId))
  const requests = useQuery(changeRequestsQuery(projectId))

  if (project.isPending) return <Spinner />
  if (project.isError) return <ErrorState error={project.error} onRetry={() => project.refetch()} />

  const canEdit = canEditSpec(me, project.data)
  const openRequests = requests.data?.filter((item) => item.status === 'OPEN') ?? []

  return (
    <>
      <PageHeader
        title={project.data.name}
        meta={
          <>
            <span>{departmentName(project.data.departmentId)}</span>
            <Mono>{project.data.repository}</Mono>
          </>
        }
        actions={
          <Link to="/projects" className="text-sm text-seal hover:underline">
            프로젝트 목록
          </Link>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)_22rem] items-start gap-4">
        <div className="min-w-0">
          <Tabs<DetailTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'spec', label: '기획서' },
              { id: 'versions', label: '버전' },
              { id: 'requests', label: openRequests.length > 0 ? `수정 요청 ${openRequests.length}` : '수정 요청' },
            ]}
          />
          {tab === 'spec' && <SpecTab project={project.data} canEdit={canEdit} />}
          {tab === 'versions' && <VersionsTab project={project.data} canEdit={canEdit} />}
          {tab === 'requests' && <ChangeRequestsTab project={project.data} canEdit={canEdit} />}
        </div>

        <div className="sticky top-4 flex flex-col gap-4">
          <OwnersPanel project={project.data} canEdit={canEdit} />

          <Sheet title="프로젝트 정보" icon={<Info size={16} aria-hidden />}>
            <KeyValues
              items={[
                { label: '담당 부서', value: departmentName(project.data.departmentId) },
                { label: '저장소', value: <Mono>{project.data.repository}</Mono> },
                { label: '기준 커밋', value: <Mono>{project.data.baseCommit}</Mono> },
                {
                  label: '기획서',
                  value: spec.data ? `v${spec.data.version}, ${spec.data.updatedBy.name}` : '불러오는 중',
                },
              ]}
            />
          </Sheet>

          <Sheet
            title={`처리 대기 수정 요청 ${openRequests.length}건`}
            icon={<BookText size={16} aria-hidden />}
            actions={
              tab !== 'requests' && (requests.data?.length ?? 0) > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => setTab('requests')}>
                  전체 보기
                </Button>
              ) : undefined
            }
          >
            {openRequests.length === 0 ? (
              <p className="text-[0.8125rem] text-ink-3">기다리는 수정 요청이 없습니다.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {openRequests.slice(0, 3).map((item) => (
                  <li key={item.id} className="flex flex-col gap-1">
                    <UserChip name={item.requester.name} sub={formatDateTime(item.createdAt)} />
                    <p className="line-clamp-2 text-[0.8125rem] text-ink-2">{item.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </Sheet>
        </div>
      </div>
    </>
  )
}

export default function ProjectsPage() {
  const { projectId } = useParams()
  return projectId ? <ProjectDetail key={projectId} projectId={projectId} /> : <ProjectList />
}
