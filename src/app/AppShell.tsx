import {
  Activity,
  BookText,
  ClipboardCheck,
  Code2,
  FileClock,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Send,
  Settings,
  ShieldBan,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { INTERNAL_ONLY_MESSAGE } from '../api/errors'
import { NetworkBadge } from '../components/badges'
import { Button } from '../components/ui'
import { menuFor, type MenuKey } from '../lib/access'
import { ROLE_LABEL } from '../lib/labels'
import { useDepartmentNames, useNetwork, usePendingApprovals, useProjects } from '../lib/queries'
import { useAuth, useMe } from './AuthProvider'

const ICONS: Record<MenuKey, LucideIcon> = {
  compose: Send,
  requests: ListChecks,
  approvals: ClipboardCheck,
  editor: Code2,
  projects: BookText,
  documents: FileText,
  forbidden: ShieldBan,
  dashboard: LayoutDashboard,
  audit: FileClock,
  settings: Settings,
  me: UserRound,
}

function Sidebar() {
  const me = useMe()
  const network = useNetwork()
  const pending = usePendingApprovals()
  const projects = useProjects()
  const pendingCount = pending.data?.length ?? 0
  const isOwner = projects.data?.some((p) => p.owners.some((o) => o.id === me.id)) ?? false
  const items = menuFor(me.role, { canApprove: pendingCount > 0 || isOwner })

  return (
    <nav aria-label="주 메뉴" className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-rule bg-sheet p-2 max-lg:w-14">
      {items.map((item) => {
        const Icon = ICONS[item.key]
        const blocked = network === 'EXTERNAL' && !item.external
        const base = 'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm max-lg:justify-center max-lg:px-0'
        if (blocked) {
          return (
            <span
              key={item.key}
              title={INTERNAL_ONLY_MESSAGE}
              aria-disabled="true"
              tabIndex={0}
              className={`${base} cursor-not-allowed text-ink-3/70`}
            >
              <Icon size={17} aria-hidden className="shrink-0" />
              <span className="max-lg:sr-only">{item.label}</span>
            </span>
          )
        }
        return (
          <NavLink
            key={item.key}
            to={item.to}
            end={item.key === 'requests'}
            title={item.label}
            className={({ isActive }) =>
              `${base} ${isActive ? 'bg-seal-soft font-medium text-seal-dark' : 'text-ink-2 hover:bg-paper hover:text-ink'}`
            }
          >
            <Icon size={17} aria-hidden className="shrink-0" />
            <span className="flex-1 truncate max-lg:sr-only">{item.label}</span>
            {item.key === 'approvals' && pendingCount > 0 && (
              <span className="rounded bg-seal px-1.5 text-xs font-medium text-white max-lg:hidden">{pendingCount}</span>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}

function Header() {
  const me = useMe()
  const { signOut } = useAuth()
  const network = useNetwork()
  const navigate = useNavigate()
  const departmentName = useDepartmentNames()
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-rule bg-sheet px-4">
      <div className="flex items-center gap-2 font-semibold text-ink">
        <Activity size={18} className="text-seal" aria-hidden />
        AI 작업 승인
      </div>
      <div className="flex items-center gap-3 text-[0.8125rem]">
        <NetworkBadge network={network} />
        <span className="text-ink-2 max-sm:hidden">
          <span className="font-medium text-ink">{me.name}</span> {ROLE_LABEL[me.role]}
          {me.departmentId ? `, ${departmentName(me.departmentId)}` : ''}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await signOut()
            navigate('/login')
          }}
        >
          <LogOut size={14} aria-hidden />
          로그아웃
        </Button>
      </div>
    </header>
  )
}

export function AppShell() {
  const network = useNetwork()
  return (
    <div className="flex h-dvh flex-col">
      {/* 지금 어느 망에 있는지 화면 어디서나 보이게 하는 띠 */}
      <div
        className={`h-1.5 shrink-0 ${network === 'EXTERNAL' ? 'band-external' : 'bg-internal'}`}
        role="presentation"
      />
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-6 pb-20">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
