import type { Role } from '../api/types'

/** 메뉴·권한 규칙을 한곳에 모았다 (요청서 3.1, 기능 명세서 3.2·3.3). */

export type MenuKey =
  | 'dashboard'
  | 'compose'
  | 'requests'
  | 'approvals'
  | 'editor'
  | 'projects'
  | 'documents'
  | 'forbidden'
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

export interface MenuGroup {
  label: string
  items: MenuItem[]
}

const dashboardLabel: Record<Role, string> = {
  ADMIN: '전사 대시보드',
  DEPT_MANAGER: '부서 대시보드',
  // TODO(spec): 요청서 3.1의 직원 메뉴에는 없지만 5.9가 직원 범위("나")를 정의해 메뉴에 넣었다.
  EMPLOYEE: '내 대시보드',
}

export function menuFor(role: Role, options: { canApprove: boolean }): MenuGroup[] {
  const work: MenuItem[] = [
    { key: 'compose', label: '작업 요청', to: '/requests/new', external: false },
    { key: 'requests', label: '내 요청', to: '/requests', external: true },
  ]
  if (role !== 'EMPLOYEE' || options.canApprove) {
    work.push({ key: 'approvals', label: '승인 대기', to: '/approvals', external: true })
  }
  work.push({ key: 'editor', label: '웹 코드 에디터', to: '/editor', external: false })

  const project: MenuItem[] = [
    { key: 'projects', label: '프로젝트 기획서', to: '/projects', external: false },
    { key: 'documents', label: '문서', to: '/documents', external: false },
  ]
  if (role === 'DEPT_MANAGER') {
    project.push({ key: 'forbidden', label: '금지 작업 제안', to: '/forbidden', external: false })
  }

  const operate: MenuItem[] = [{ key: 'audit', label: '감사 로그', to: '/audit', external: true }]
  if (role === 'ADMIN') operate.push({ key: 'settings', label: '설정', to: '/settings', external: false })
  operate.push({ key: 'me', label: '내 정보', to: '/me', external: false })

  return [
    { label: '개요', items: [{ key: 'dashboard', label: dashboardLabel[role], to: '/dashboard', external: true }] },
    { label: '작업', items: work },
    { label: '프로젝트', items: project },
    { label: '운영', items: operate },
  ]
}

/** 로그인 직후 또는 "/"로 들어왔을 때 갈 화면. 내 할 일이 한눈에 보이는 대시보드로 보낸다. */
export function homePath(): string {
  return '/dashboard'
}
