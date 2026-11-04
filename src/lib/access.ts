import type { Role } from '../api/types'

/** 메뉴·권한 규칙을 한곳에 모았다 (요청서 3.1, 기능 명세서 3.2·3.3). */

export type MenuKey =
  | 'compose'
  | 'requests'
  | 'approvals'
  | 'editor'
  | 'projects'
  | 'documents'
  | 'forbidden'
  | 'dashboard'
  | 'audit'
  | 'settings'
  | 'me'

export interface MenuItem {
  key: MenuKey
  label: string
  to: string
  /** 외부망에서도 쓸 수 있는 화면 (3.3) */
  external: boolean
}

const dashboardLabel: Record<Role, string> = {
  ADMIN: '전사 대시보드',
  DEPT_MANAGER: '부서 대시보드',
  // TODO(spec): 요청서 3.1의 직원 메뉴에는 없지만 5.9가 직원 범위("나")를 정의해 메뉴에 넣었다.
  EMPLOYEE: '내 대시보드',
}

export function menuFor(role: Role, options: { canApprove: boolean }): MenuItem[] {
  const items: MenuItem[] = [
    { key: 'compose', label: '작업 요청', to: '/requests/new', external: false },
    { key: 'requests', label: '내 요청', to: '/requests', external: true },
  ]
  if (role !== 'EMPLOYEE' || options.canApprove) {
    items.push({ key: 'approvals', label: '승인 대기', to: '/approvals', external: true })
  }
  items.push(
    { key: 'editor', label: '웹 코드 에디터', to: '/editor', external: false },
    { key: 'projects', label: '프로젝트 기획서', to: '/projects', external: false },
    { key: 'documents', label: '문서', to: '/documents', external: false },
  )
  if (role === 'DEPT_MANAGER') {
    items.push({ key: 'forbidden', label: '금지 작업 제안', to: '/forbidden', external: false })
  }
  items.push(
    { key: 'dashboard', label: dashboardLabel[role], to: '/dashboard', external: true },
    { key: 'audit', label: '감사 로그', to: '/audit', external: true },
  )
  if (role === 'ADMIN') {
    items.push({ key: 'settings', label: '설정', to: '/settings', external: false })
  }
  items.push({ key: 'me', label: '내 정보', to: '/me', external: false })
  return items
}

/** 로그인 직후 또는 "/"로 들어왔을 때 갈 화면 */
export function homePath(network: 'INTERNAL' | 'EXTERNAL'): string {
  return network === 'INTERNAL' ? '/requests/new' : '/requests'
}
