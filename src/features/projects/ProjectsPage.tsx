import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { projectsApi } from '../../api/endpoints'
import type { Me, Project } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { EmptyState, ErrorState, Mono, PageHeader, Sheet, Spinner, Tabs } from '../../components/ui'
import { useDepartmentNames, useProjects } from '../../lib/queries'
import { OwnersTab } from './OwnersTab'
import { ChangeRequestsTab, SpecTab, VersionsTab } from './SpecTabs'

function canEditSpec(me: Me, project: Project): boolean {
  return me.role === 'ADMIN' || (me.role === 'DEPT_MANAGER' && me.departmentId === project.departmentId)
}

function ProjectList() {
  const navigate = useNavigate()
  const projects = useProjects()
  const departmentName = useDepartmentNames()
  return (
    <>
      <PageHeader title="프로젝트 기획서" description="프로젝트마다 기획서가 하나씩 있습니다. AI 분석과 담당자 지정의 기준이 됩니다." />
      <Sheet flush>
        {projects.isPending ? (
          <Spinner />
        ) : projects.isError ? (
          <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
        ) : projects.data.length === 0 ? (
          <EmptyState title="프로젝트가 없습니다">관리자가 설정에서 프로젝트를 만들면 여기에 나타납니다.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>프로젝트</th>
                  <th>담당 부서</th>
                  <th>저장소</th>
                  <th>담당자</th>
                </tr>
              </thead>
              <tbody>
                {projects.data.map((project) => (
                  <tr key={project.id} data-clickable="true" onClick={() => navigate(`/projects/${project.id}`)}>
                    <td>
                      <Link
                        to={`/projects/${project.id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="font-medium text-seal hover:underline"
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td>{departmentName(project.departmentId)}</td>
                    <td>
                      <Mono>{project.repository}</Mono>
                    </td>
                    <td>{project.owners.map((owner) => owner.name).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Sheet>
    </>
  )
}

type DetailTab = 'spec' | 'versions' | 'owners' | 'requests'

function ProjectDetail({ projectId }: { projectId: string }) {
  const me = useMe()
  const departmentName = useDepartmentNames()
  const [tab, setTab] = useState<DetailTab>('spec')
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => projectsApi.get(projectId) })

  if (project.isPending) return <Spinner />
  if (project.isError) return <ErrorState error={project.error} onRetry={() => project.refetch()} />

  const canEdit = canEditSpec(me, project.data)
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
      <Tabs<DetailTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'spec', label: '기획서' },
          { id: 'versions', label: '버전' },
          { id: 'owners', label: `담당자 ${project.data.owners.length}명` },
          { id: 'requests', label: '수정 요청' },
        ]}
      />
      {tab === 'spec' && <SpecTab project={project.data} canEdit={canEdit} />}
      {tab === 'versions' && <VersionsTab project={project.data} canEdit={canEdit} />}
      {tab === 'owners' && <OwnersTab project={project.data} canEdit={canEdit} />}
      {tab === 'requests' && <ChangeRequestsTab project={project.data} canEdit={canEdit} />}
    </>
  )
}

export default function ProjectsPage() {
  const { projectId } = useParams()
  return projectId ? <ProjectDetail key={projectId} projectId={projectId} /> : <ProjectList />
}
