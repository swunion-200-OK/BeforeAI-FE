import {
  BookText,
  ClipboardCheck,
  Code2,
  FileClock,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Plus,
  Send,
  Settings,
  ShieldBan,
  Stamp,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { NavLink, Outlet, useLocation, useMatches, useNavigate } from 'react-router'
import { INTERNAL_ONLY_MESSAGE } from '../api/errors'
import { NetworkBadge } from '../components/badges'
import { Avatar } from '../components/rich'
import { Button } from '../components/ui'
import { menuFor, type MenuKey } from '../lib/access'
import { ROLE_LABEL } from '../lib/labels'
import { useDepartmentNames, useNetwork, usePendingApprovals, useProjects } from '../lib/queries'
import { useAuth, useMe } from './AuthProvider'

const ICONS: Record<MenuKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  compose: Send,
  requests: ListChecks,
  approvals: ClipboardCheck,
  editor: Code2,
  projects: BookText,
  documents: FileText,
  forbidden: ShieldBan,
  audit: FileClock,
  settings: Settings,
  me: UserRound,
}

function Sidebar() {
  const me = useMe()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const network = useNetwork()
  const departmentName = useDepartmentNames()
  const pending = usePendingApprovals()
  const projects = useProjects()
  // 목록에서 한 줄로 보이는 단위인 요청 수를 센다. 작업 수를 세면 눌렀을 때 숫자가 달라 보인다.
  const pendingCount = new Set(pending.data?.map((item) => item.requestId)).size
  const isOwner = projects.data?.some((p) => p.owners.some((o) => o.id === me.id)) ?? false
  const groups = menuFor(me.role, { canApprove: pendingCount > 0 || isOwner })
  const base = 'flex h-10 items-center gap-3 rounded-lg px-3 text-[0.9375rem]'

  return (
    <aside className="flex w-[232px] shrink-0 flex-col bg-nav text-nav-ink">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-seal text-white">
          <Stamp size={17} aria-hidden />
        </span>
        <span className="font-bold tracking-tight text-white">AI 작업 승인</span>
      </div>

      <nav aria-label="주 메뉴" className="quiet-scroll flex-1 overflow-y-auto px-2.5 pb-3">
        {groups.map((group) => (
          <div key={group.label} className="mt-4 flex flex-col gap-0.5 first:mt-1">
            {group.items.map((item) => {
              const Icon = ICONS[item.key]
              if (network === 'EXTERNAL' && !item.external) {
                return (
                  <span
                    key={item.key}
                    role="link"
                    aria-disabled="true"
                    aria-label={`${item.label}: ${INTERNAL_ONLY_MESSAGE}`}
                    title={INTERNAL_ONLY_MESSAGE}
                    tabIndex={0}
                    className={`${base} cursor-not-allowed text-nav-dim/60`}
                  >
                    <Icon size={18} aria-hidden className="shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                )
              }
              return (
                <NavLink
                  key={item.key}
                  to={item.to}
                  end={item.key === 'requests'}
                  className={({ isActive }) =>
                    `${base} ${isActive ? 'bg-nav-2 font-medium text-white' : 'hover:bg-nav-2/60 hover:text-white'}`
                  }
                >
                  <Icon size={18} aria-hidden className="shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.key === 'approvals' && pendingCount > 0 && (
                    <span className="rounded-full bg-seal px-1.5 text-xs font-semibold text-white tabular-nums">
                      {pendingCount}
                    </span>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2 border-t border-white/10 p-3">
        <Avatar name={me.name} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-white">{me.name}</p>
          <p className="truncate text-xs text-nav-dim">
            {ROLE_LABEL[me.role]}
            {me.departmentId ? `, ${departmentName(me.departmentId)}` : ''}
          </p>
        </div>
        <button
          type="button"
          aria-label="로그아웃"
          title="로그아웃"
          className="rounded-md p-1.5 text-nav-dim hover:bg-nav-2 hover:text-white"
          onClick={async () => {
            await signOut()
            navigate('/login', { replace: true })
          }}
        >
          <LogOut size={16} aria-hidden />
        </button>
      </div>
    </aside>
  )
}

function TopBar() {
  const network = useNetwork()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // 파란 버튼은 화면의 할 일 하나에만 쓴다. 이미 작업 요청 화면이면 이 버튼은 필요 없다.
  const composing = pathname.startsWith('/requests/new')
  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-rule bg-sheet px-5">
      {network === 'EXTERNAL' && <span className="text-sm text-external">승인과 조회 위주로 쓸 수 있습니다</span>}
      <NetworkBadge network={network} />
      {!composing && (
        <Button internalOnly onClick={() => navigate('/requests/new')}>
          <Plus size={16} aria-hidden />새 작업 요청
        </Button>
      )}
    </header>
  )
}

export function AppShell() {
  const network = useNetwork()
  const fullBleed = useMatches().some((match) => (match.handle as { fullBleed?: boolean } | undefined)?.fullBleed)
  return (
    <div className="flex h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 지금 어느 망에 있는지 화면 어디서나 보이게 하는 띠 */}
        <div
          className={`h-1 shrink-0 ${network === 'EXTERNAL' ? 'band-external' : 'bg-internal'}`}
          role="presentation"
        />
        <TopBar />
        {fullBleed ? (
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        ) : (
          <main className="quiet-scroll min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1400px] px-8 py-6 pb-16">
              <Outlet />
            </div>
          </main>
        )}
      </div>
    </div>
  )
}
