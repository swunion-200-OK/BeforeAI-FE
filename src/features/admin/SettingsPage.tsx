import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../components/ui'
import { withoutSlackOnServer } from '../../lib/serverFeatures'
import { ForbiddenAdminPanel } from '../forbidden/ForbiddenAdminPanel'
import { AccountsTab } from './AccountsTab'
import { proposalsQuery, signingKeysQuery } from './adminQueries'
import { KeysTab } from './KeysTab'
import { KillAllTab } from './KillAllTab'
import { PolicyTab } from './PolicyTab'
import { ProjectsTab } from './ProjectsTab'
import { SlackTab } from './SlackTab'

const ALL_TABS = [
  { id: 'accounts', label: '계정·권한', Panel: AccountsTab },
  { id: 'policy', label: '정책·승인 기준표', Panel: PolicyTab },
  { id: 'forbidden', label: '금지 작업', Panel: ForbiddenAdminPanel },
  { id: 'keys', label: '승인 키', Panel: KeysTab },
  { id: 'projects', label: '프로젝트', Panel: ProjectsTab },
  { id: 'slack', label: 'Slack', Panel: SlackTab },
  { id: 'emergency', label: '전사 일괄 중단', Panel: KillAllTab },
] as const

type TabId = (typeof ALL_TABS)[number]['id']

const TABS = withoutSlackOnServer(ALL_TABS, (tab) => tab.id === 'slack')

/** 처리할 일이 있는 탭의 건수 */
function useTabBadges(): Partial<Record<TabId, { count: number; label: string }>> {
  const proposals = useQuery(proposalsQuery('OPEN'))
  const keys = useQuery(signingKeysQuery)
  return {
    forbidden: { count: proposals.data?.length ?? 0, label: '검토 대기 제안' },
    keys: { count: keys.data?.filter((key) => key.status === 'PENDING').length ?? 0, label: '등록 대기 키' },
  }
}

function TabNav({ current, onSelect }: { current: TabId; onSelect: (id: TabId) => void }) {
  const badges = useTabBadges()
  return (
    <div role="tablist" aria-orientation="vertical" aria-label="설정 항목" className="flex flex-col gap-0.5 md:sticky md:top-4">
      {TABS.map(({ id, label }) => {
        const active = id === current
        const badge = badges[id]
        const danger = id === 'emergency'
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(id)}
            className={`flex h-10 items-center gap-2.5 rounded-md px-3 text-left text-[0.9375rem] ${danger ? 'mt-3' : ''} ${
              active
                ? danger
                  ? 'bg-sheet-alt font-semibold text-high shadow-[inset_3px_0_0_var(--color-high)]'
                  : 'bg-sheet-alt font-semibold text-ink shadow-[inset_3px_0_0_var(--color-seal)]'
                : danger
                  ? 'text-high hover:bg-sheet-alt'
                  : 'text-ink-2 hover:bg-sheet-alt hover:text-ink'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {badge && badge.count > 0 && (
              <span
                title={`${badge.label} ${badge.count}건`}
                className="text-xs font-semibold text-medium tabular-nums"
              >
                <span className="sr-only">{badge.label} </span>
                {badge.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function SettingsPage() {
  const { tab } = useParams()
  const navigate = useNavigate()
  const current = TABS.find((item) => item.id === tab) ?? TABS[0]
  const { Panel } = current
  return (
    <>
      <PageHeader title="설정" />
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[13.5rem_minmax(0,1fr)] md:gap-6">
        <TabNav current={current.id} onSelect={(id) => navigate(`/settings/${id}`)} />
        <div role="tabpanel" aria-label={current.label} className="min-w-0">
          <Panel />
        </div>
      </div>
    </>
  )
}
