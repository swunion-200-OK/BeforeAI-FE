import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { projectsApi } from '../../api/endpoints'
import { withRo } from '../../lib/josa'
import type { Me, Project } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { AvatarStack, KeyValues } from '../../components/rich'
import { toast } from '../../components/toast'
import { Button, EmptyState, ErrorState, Mono, PageHeader, Sheet, Spinner, Tabs } from '../../components/ui'
import { useDepartmentNames, useProjects, useRefreshAll } from '../../lib/queries'
import { OwnersModal } from './OwnersModal'
import { changeRequestsQuery, ownerCandidatesQuery, specQuery } from './queries'
import { ChangeRequestModal, ChangeRequestsTab, SpecTab, VersionsTab } from './SpecTabs'

function canEditSpec(me: Me, project: Project): boolean {
  return me.role === 'ADMIN' || (me.role === 'DEPT_MANAGER' && me.departmentId === project.departmentId)
}

function ProjectList() {
  const navigate = useNavigate()
  const projects = useProjects()
  const departmentName = useDepartmentNames()
  const list = projects.data ?? []
  const specs = useQueries({ queries: list.map((project) => specQuery(project.id)) })

  return (
    <div>
      <PageHeader title="프로젝트 기획서" description="AI 분석과 담당자 지정의 기준이 되는 문서입니다." />
      {projects.isPending ? (
        <Spinner />
      ) : projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title="프로젝트가 없습니다">관리자가 설정에서 프로젝트를 만들면 여기에 나타납니다.</EmptyState>
      ) : (
        <Sheet flush>
          <table className="sheet-table [&_td]:py-4">
            <thead>
              <tr>
                <th>프로젝트</th>
                <th>담당 부서</th>
                <th>담당자</th>
                <th>기획서</th>
              </tr>
            </thead>
            <tbody>
              {list.map((project, index) => {
                const to = `/projects/${project.id}`
                const spec = specs[index]?.data
                return (
                  <tr key={project.id} data-clickable="true" onClick={() => navigate(to)}>
                    <td className="font-medium">
                      <Link to={to} className="hover:text-seal" onClick={(event) => event.stopPropagation()}>
                        {project.name}
                      </Link>
                    </td>
                    <td className="text-ink-2">{departmentName(project.departmentId)}</td>
                    <td className="text-ink-2">{project.owners.map((owner) => owner.name).join(', ')}</td>
                    <td className="text-ink-2 tabular-nums">{spec && `v${spec.version}`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Sheet>
      )}
    </div>
  )
}

type DetailTab = 'spec' | 'versions' | 'requests'

const META_BUTTON = 'text-seal hover:underline'

function ProjectBody({ project }: { project: Project }) {
  const me = useMe()
  const refreshAll = useRefreshAll()
  const departmentName = useDepartmentNames()
  const [tab, setTab] = useState<DetailTab>('spec')
  const [draft, setDraft] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [managingOwners, setManagingOwners] = useState(false)
  const [showInfo, setShowInfo] = useState(false)

  const canEdit = canEditSpec(me, project)
  const spec = useQuery(specQuery(project.id))
  const requests = useQuery(changeRequestsQuery(project.id))
  // 계정 목록은 관리자만 읽을 수 있다. 부서 관리자는 비활성 담당자 표시 없이 본다.
  const users = useQuery({ ...ownerCandidatesQuery, enabled: me.role === 'ADMIN' })
  const save = useMutation({
    mutationFn: (body: string) => projectsApi.updateSpec(project.id, body),
    onSuccess: async (saved) => {
      await refreshAll()
      setDraft(null)
      toast.success(`기획서를 ${withRo(`v${saved.version}`)} 저장했습니다`)
    },
  })

  const openCount = requests.data?.filter((item) => item.status === 'OPEN').length ?? 0
  const inactiveIds = new Set(users.data?.filter((user) => !user.active).map((user) => user.id))
  const inactiveOwners = project.owners.filter((owner) => inactiveIds.has(owner.id)).length
  const ownerNames = project.owners.map((owner) => owner.name)
  const editing = draft !== null

  return (
    <div>
      <PageHeader
        title={project.name}
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>{departmentName(project.departmentId)}</span>
            <span className="inline-flex items-center gap-1.5">
              <AvatarStack names={ownerNames} />
              {ownerNames.join(', ')}
            </span>
            {inactiveOwners > 0 && <span className="font-medium text-medium">비활성 계정 {inactiveOwners}명</span>}
            {canEdit && (
              <button type="button" className={META_BUTTON} onClick={() => setManagingOwners(true)}>
                담당자 관리
              </button>
            )}
            <button
              type="button"
              aria-expanded={showInfo}
              className={META_BUTTON}
              onClick={() => setShowInfo((value) => !value)}
            >
              자세히
            </button>
          </div>
        }
        actions={
          editing ? (
            <>
              <Button onClick={() => setDraft(null)}>편집 취소</Button>
              <Button
                variant="primary"
                disabled={draft === spec.data?.body}
                disabledReason="바뀐 내용이 없습니다"
                loading={save.isPending}
                onClick={() => save.mutate(draft)}
              >
                새 버전으로 저장
              </Button>
            </>
          ) : canEdit ? (
            <Button
              variant="primary"
              disabled={!spec.data}
              onClick={() => {
                setTab('spec')
                setDraft(spec.data?.body ?? null)
              }}
            >
              수정
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setRequesting(true)}>
              수정 요청
            </Button>
          )
        }
      />

      {showInfo && (
        <div className="mb-5">
          <KeyValues
            items={[
              { label: '저장소', value: <Mono>{project.repository}</Mono> },
              { label: '담당자', value: ownerNames.join(', ') },
            ]}
          />
          <p className="mt-2 text-[0.875rem] text-ink-3">
            담당자는 모두 같은 권한으로 DB 접근·데이터 수정·배포 작업을 승인합니다.
          </p>
        </div>
      )}

      {/* 고치는 동안에는 본문만 남긴다 */}
      {!editing && (
        <Tabs<DetailTab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'spec', label: '기획서' },
            { id: 'versions', label: '버전' },
            { id: 'requests', label: openCount > 0 ? `수정 요청 ${openCount}` : '수정 요청' },
          ]}
        />
      )}
      {tab === 'spec' && <SpecTab project={project} draft={draft} onDraftChange={setDraft} />}
      {tab === 'versions' && <VersionsTab project={project} canEdit={canEdit} />}
      {tab === 'requests' && <ChangeRequestsTab project={project} canEdit={canEdit} />}

      <ChangeRequestModal open={requesting} projectId={project.id} onClose={() => setRequesting(false)} />
      {managingOwners && <OwnersModal project={project} onClose={() => setManagingOwners(false)} />}
    </div>
  )
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => projectsApi.get(projectId) })
  if (project.isPending) return <Spinner />
  if (project.isError) return <ErrorState error={project.error} onRetry={() => project.refetch()} />
  return <ProjectBody project={project.data} />
}

export default function ProjectsPage() {
  const { projectId } = useParams()
  return projectId ? <ProjectDetail key={projectId} projectId={projectId} /> : <ProjectList />
}
