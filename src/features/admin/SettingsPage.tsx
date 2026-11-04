import { useQuery } from '@tanstack/react-query'
import { FolderPlus, KeyRound, MessageSquare, OctagonX, Scale, ShieldBan, UsersRound } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../components/ui'
import { ForbiddenAdminPanel } from '../forbidden/ForbiddenAdminPanel'
import { AccountsTab } from './AccountsTab'
import { proposalsQuery, runningRequestsQuery, signingKeysQuery } from './adminQueries'
import { KeysTab } from './KeysTab'
import { KillAllTab } from './KillAllTab'
import { PolicyTab } from './PolicyTab'
import { ProjectsTab } from './ProjectsTab'
import { SlackTab } from './SlackTab'

const TABS = [
  { id: 'accounts', label: '계정·권한', icon: UsersRound, Panel: AccountsTab },
  { id: 'policy', label: '정책·승인 기준표', icon: Scale, Panel: PolicyTab },
  { id: 'forbidden', label: '금지 작업 확정', icon: ShieldBan, Panel: ForbiddenAdminPanel },
  { id: 'keys', label: '승인 키 등록', icon: KeyRound, Panel: KeysTab },
  { id: 'projects', label: '프로젝트 생성', icon: FolderPlus, Panel: ProjectsTab },
  { id: 'slack', label: 'Slack 연동', icon: MessageSquare, Panel: SlackTab },
  { id: 'emergency', label: '전사 일괄 중단', icon: OctagonX, Panel: KillAllTab },
] as const

type TabId = (typeof TABS)[number]['id']

/** 처리할 일이 있는 탭의 건수 */
function useTabBadges(): Partial<Record<TabId, { count: number; label: string; className: string }>> {
  const proposals = useQuery(proposalsQuery('OPEN'))
  const keys = useQuery(signingKeysQuery)
  const running = useQuery({ ...runningRequestsQuery, refetchInterval: 5000 })
  const pendingKeys = keys.data?.filter((key) => key.status === 'PENDING').length ?? 0
  return {
    forbidden: { count: proposals.data?.length ?? 0, label: '검토 대기 제안', className: 'bg-medium-soft text-medium' },
    keys: { count: pendingKeys, label: '등록 대기 키', className: 'bg-medium-soft text-medium' },
    emergency: { count: running.data?.length ?? 0, label: '실행 중 요청', className: 'bg-internal-soft text-internal' },
  }
}

function TabNav({ current, onSelect }: { current: TabId; onSelect: (id: TabId) => void }) {
  const badges = useTabBadges()
  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label="설정 항목"
      className="sticky top-4 flex flex-col gap-0.5 rounded-xl border border-rule bg-sheet p-1.5 shadow-card"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
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
            className={`flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm ${danger ? 'mt-1.5' : ''} ${
              active
                ? danger
                  ? 'bg-high-soft font-semibold text-high'
                  : 'bg-seal-soft font-semibold text-seal-dark'
                : danger
                  ? 'text-high hover:bg-high-soft/60'
                  : 'text-ink-2 hover:bg-paper hover:text-ink'
            }`}
          >
            <Icon size={17} aria-hidden className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {badge && badge.count > 0 && (
              <span
                title={`${badge.label} ${badge.count}건`}
                className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${badge.className}`}
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
      <PageHeader title="설정" description="계정과 승인 정책, 금지 작업, 승인 키를 관리합니다. 내부망에서만 바꿀 수 있습니다." />
      <div className="grid grid-cols-[13.5rem_minmax(0,1fr)] items-start gap-4">
        <TabNav current={current.id} onSelect={(id) => navigate(`/settings/${id}`)} />
        <div role="tabpanel" aria-label={current.label} className="min-w-0">
          <Panel />
        </div>
      </div>
    </>
  )
}
