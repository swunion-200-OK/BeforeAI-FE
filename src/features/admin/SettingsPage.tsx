import { useNavigate, useParams } from 'react-router'
import { PageHeader, Tabs } from '../../components/ui'
import { ForbiddenAdminPanel } from '../forbidden/ForbiddenAdminPanel'
import { AccountsTab } from './AccountsTab'
import { KeysTab } from './KeysTab'
import { KillAllTab } from './KillAllTab'
import { PolicyTab } from './PolicyTab'
import { ProjectsTab } from './ProjectsTab'
import { SlackTab } from './SlackTab'

const TABS = [
  { id: 'accounts', label: '계정·권한', Panel: AccountsTab },
  { id: 'policy', label: '정책·승인 기준표', Panel: PolicyTab },
  { id: 'forbidden', label: '금지 작업 확정', Panel: ForbiddenAdminPanel },
  { id: 'keys', label: '승인 키 등록', Panel: KeysTab },
  { id: 'projects', label: '프로젝트 생성', Panel: ProjectsTab },
  { id: 'slack', label: 'Slack 연동', Panel: SlackTab },
  { id: 'emergency', label: '전사 일괄 중단', Panel: KillAllTab },
] as const

type TabId = (typeof TABS)[number]['id']

export default function SettingsPage() {
  const { tab } = useParams()
  const navigate = useNavigate()
  const current = TABS.find((item) => item.id === tab) ?? TABS[0]
  const { Panel } = current
  return (
    <>
      <PageHeader title="설정" />
      <Tabs<TabId>
        tabs={TABS.map(({ id, label }) => ({ id, label }))}
        value={current.id}
        onChange={(id) => navigate(`/settings/${id}`)}
      />
      <Panel />
    </>
  )
}
