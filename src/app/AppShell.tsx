import {
  ArrowLeft,
  BookText,
  ClipboardCheck,
  Code2,
  FileClock,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Plus,
  Send,
  Settings,
  ShieldBan,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useMatches, useNavigate } from 'react-router'
import { useEffect, useRef } from 'react'
import type { MouseEvent } from 'react'
import { INTERNAL_ONLY_MESSAGE } from '../api/errors'
import { NetworkBadge } from '../components/badges'
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
  const base = 'flex h-10 items-center gap-2.5 rounded-md px-2.5 text-base'

  return (
    <aside className="flex w-[15rem] shrink-0 flex-col border-r border-rule bg-nav text-nav-ink">
      <div className="flex h-14 shrink-0 items-center px-5">
        <span className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink">BeforeAI</span>
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
                    className={`${base} cursor-not-allowed text-ink-3/70`}
                  >
                    <Icon size={17} strokeWidth={1.75} aria-hidden className="shrink-0" />
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
                    `${base} ${isActive ? 'bg-nav-2 font-semibold text-ink' : 'hover:bg-nav-2/60 hover:text-ink'}`
                  }
                >
                  <Icon size={17} strokeWidth={1.75} aria-hidden className="shrink-0" />
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

      <div className="flex items-center gap-2 border-t border-rule py-3 pr-3 pl-5">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-ink">{me.name}</p>
          <p className="truncate text-xs text-ink-3">
            {ROLE_LABEL[me.role]}
            {me.departmentId ? `, ${departmentName(me.departmentId)}` : ''}
          </p>
        </div>
        <button
          type="button"
          aria-label="로그아웃"
          title="로그아웃"
          className="rounded-md p-1.5 text-ink-3 hover:bg-nav-2 hover:text-ink"
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

/** 모바일에서는 폭을 차지하는 사이드바 대신 접을 수 있는 메뉴를 쓴다. */
function MobileNavigation() {
  const me = useMe()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const network = useNetwork()
  const menuRef = useRef<HTMLDetailsElement>(null)
  const pending = usePendingApprovals()
  const projects = useProjects()
  const pendingCount = new Set(pending.data?.map((item) => item.requestId)).size
  const isOwner = projects.data?.some((p) => p.owners.some((o) => o.id === me.id)) ?? false
  const groups = menuFor(me.role, { canApprove: pendingCount > 0 || isOwner })
  const closeMenu = (event: MouseEvent<HTMLAnchorElement>) => {
    const menu = event.currentTarget.closest('details')
    if (menu) menu.open = false
  }

  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const closeOutside = (event: PointerEvent) => {
      if (menu.open && !menu.contains(event.target as Node)) menu.open = false
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !menu.open) return
      event.preventDefault()
      menu.open = false
      menu.querySelector('summary')?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useEffect(() => {
    if (menuRef.current) menuRef.current.open = false
  }, [location.pathname])

  return (
    <div className="relative z-30 border-b border-rule bg-sheet xl:hidden">
      <div className="flex h-12 items-center justify-between px-4">
        <span className="text-base font-semibold tracking-tight text-ink">AI 작업 승인</span>
        <details ref={menuRef} className="group relative">
          <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-sm font-medium text-ink hover:bg-sheet-alt [&::-webkit-details-marker]:hidden">
            <Menu size={18} aria-hidden />
            메뉴
          </summary>
          <nav aria-label="주 메뉴" className="absolute right-0 top-full mt-1 max-h-[75dvh] w-64 overflow-y-auto rounded-lg border border-rule bg-sheet p-2 shadow-lg">
            {groups.map((group) => (
              <div key={group.label} className="mt-3 first:mt-1">
                <p className="px-2.5 pb-1 text-xs font-semibold text-ink-3">{group.label}</p>
                {group.items.map((item) => {
                  const Icon = ICONS[item.key]
                  if (network === 'EXTERNAL' && !item.external) {
                    return (
                      <span key={item.key} aria-disabled="true" title={INTERNAL_ONLY_MESSAGE} className="flex h-11 items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-3/70">
                        <Icon size={17} aria-hidden />
                        {item.label}
                      </span>
                    )
                  }
                  return (
                    <NavLink
                      key={item.key}
                      to={item.to}
                      end={item.key === 'requests'}
                      onClick={closeMenu}
                      className={({ isActive }) => `flex h-11 items-center gap-2.5 rounded-md px-2.5 text-sm ${isActive ? 'bg-nav-2 font-semibold text-ink' : 'text-ink-2 hover:bg-sheet-alt hover:text-ink'}`}
                    >
                      <Icon size={17} aria-hidden />
                      {item.label}
                    </NavLink>
                  )
                })}
              </div>
            ))}
            <div className="mt-2 border-t border-rule pt-2">
              <p className="px-2.5 pb-1 text-xs text-ink-3">{me.name} · {ROLE_LABEL[me.role]}</p>
              <button
                type="button"
                className="flex h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-2 hover:bg-sheet-alt hover:text-ink"
                onClick={async () => {
                  await signOut()
                  navigate('/login', { replace: true })
                }}
              >
                <LogOut size={17} aria-hidden />
                로그아웃
              </button>
            </div>
          </nav>
        </details>
      </div>
    </div>
  )
}

/** 경로별 화면 설정. back: 상세 화면에서 목록으로 돌아가는 링크 */
interface RouteHandle {
  fullBleed?: boolean
  back?: { to: string; label: string }
}

function TopBar({ fullBleed }: { fullBleed: boolean }) {
  const network = useNetwork()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // 사이드바의 "작업 요청"과 겹치므로 목록을 보다가 새로 시작하는 두 화면에만 둔다.
  const showCompose = pathname === '/dashboard' || pathname === '/requests'
  const back = useMatches()
    .map((match) => (match.handle as RouteHandle | undefined)?.back)
    .find(Boolean)
  const external = network === 'EXTERNAL'
  // 보여 줄 것이 없으면 선을 긋지 않는다. 메뉴를 옮겨 다녀도 제목 높이가 그대로이도록 자리는 남긴다.
  if (!back && !external && !showCompose) return fullBleed ? null : <div className="hidden h-14 shrink-0 xl:block" />
  return (
    <header className="flex h-12 shrink-0 items-center justify-end gap-3 border-b border-rule bg-sheet px-3 xl:h-14 xl:px-5">
      {back && (
        <Link to={back.to} className="mr-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-ink-2 hover:bg-sheet-alt hover:text-ink">
          <ArrowLeft size={17} aria-hidden />
          {back.label}
        </Link>
      )}
      {/* 접속 위치는 서버가 판단한다. 평소에는 표시하지 않고, 쓸 수 있는 기능이 줄어드는 외부망일 때만 알린다. */}
      {external && (
        <>
          <span className="text-sm text-external">조회와 실행 중단 위주로 쓸 수 있습니다</span>
          <NetworkBadge network={network} />
        </>
      )}
      {showCompose && (
        <Button internalOnly onClick={() => navigate('/requests/new')}>
          <Plus size={16} aria-hidden />새 작업 요청
        </Button>
      )}
    </header>
  )
}

export function AppShell() {
  const network = useNetwork()
  const fullBleed = useMatches().some((match) => (match.handle as RouteHandle | undefined)?.fullBleed)
  // main의 relative: 안쪽의 absolute 요소(sr-only 등)가 스크롤 영역 밖으로 나가 문서 전체를 늘리지 않게 한다.
  return (
    <div className="flex h-dvh flex-col xl:flex-row">
      <div className="hidden xl:flex"><Sidebar /></div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobileNavigation />
        {/* 기능이 제한되는 외부망임을 화면 어디서나 알아보게 하는 띠 */}
        {network === 'EXTERNAL' && <div className="band-external h-1 shrink-0" role="presentation" />}
        <TopBar fullBleed={fullBleed} />
        {fullBleed ? (
          <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        ) : (
          <main className="quiet-scroll relative min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[80rem] px-8 py-8 pb-20">
              <Outlet />
            </div>
          </main>
        )}
      </div>
    </div>
  )
}
