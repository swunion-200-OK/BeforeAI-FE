import { lazy } from 'react'
import { createBrowserRouter } from 'react-router'
import { AppShell } from './AppShell'
import { Root } from './Root'
import { RouteError } from './RouteError'
import { HomeRedirect, RequireAuth, RequireInternal, RequireRole } from './guards'
import NotFoundPage from './NotFoundPage'

const LoginPage = lazy(() => import('../features/auth/LoginPage'))
const MePage = lazy(() => import('../features/me/MePage'))
const ComposePage = lazy(() => import('../features/requests/ComposePage'))
const RequestListPage = lazy(() => import('../features/requests/RequestListPage'))
const RequestDetailPage = lazy(() => import('../features/requests/RequestDetailPage'))
const PendingListPage = lazy(() => import('../features/approvals/PendingListPage'))
const ApprovalDetailPage = lazy(() => import('../features/approvals/ApprovalDetailPage'))
const EditorPage = lazy(() => import('../features/editor/EditorPage'))
const DocumentsPage = lazy(() => import('../features/documents/DocumentsPage'))
const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'))
const AuditPage = lazy(() => import('../features/audit/AuditPage'))
const ProjectsPage = lazy(() => import('../features/projects/ProjectsPage'))
const ForbiddenPage = lazy(() => import('../features/forbidden/ForbiddenPage'))
const SettingsPage = lazy(() => import('../features/admin/SettingsPage'))

// 목 빌드에만 있는 시연 화면. 빌드할 때 값이 박히는 조건이라 VITE_API_BASE_URL을 주면 경로와 코드가 함께 빠진다.
const mockOnlyRoutes = import.meta.env.VITE_API_BASE_URL
  ? []
  : [{ path: '/demo/tamper', Component: lazy(() => import('../features/demo/TamperDemoPage')) }]

export const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          // 창 전체를 시연에 쓰므로 사이드바가 있는 앱 뼈대 밖에 둔다.
          ...mockOnlyRoutes,
          {
            element: <AppShell />,
            children: [
              {
                // 화면 하나가 잘못돼도 메뉴는 남겨 다른 화면으로 갈 수 있게 한다.
                errorElement: <RouteError />,
                children: [
                  { index: true, element: <HomeRedirect /> },
                  // 외부망에서도 쓰는 화면 (기능 명세서 3.3)
                  { path: '/requests', element: <RequestListPage /> },
                  { path: '/approvals', element: <PendingListPage />, handle: { fullBleed: true } },
                  { path: '/approvals/:requestId', element: <ApprovalDetailPage />, handle: { fullBleed: true } },
                  { path: '/dashboard', element: <DashboardPage /> },
                  { path: '/audit', element: <AuditPage /> },
                  // 내부망 전용 화면
                  {
                    element: <RequireInternal />,
                    children: [
                      { path: '/requests/new', element: <ComposePage /> },
                      { path: '/requests/new/:requestId', element: <ComposePage />, handle: { back: { to: '/requests', label: '내 요청' } } },
                      { path: '/editor', element: <EditorPage />, handle: { fullBleed: true } },
                      { path: '/editor/:projectId', element: <EditorPage />, handle: { fullBleed: true } },
                      { path: '/documents', element: <DocumentsPage /> },
                      { path: '/documents/:documentId', element: <DocumentsPage /> },
                      { path: '/projects', element: <ProjectsPage /> },
                      { path: '/projects/:projectId', element: <ProjectsPage />, handle: { back: { to: '/projects', label: '프로젝트 기획서' } } },
                      { path: '/me', element: <MePage /> },
                      {
                        element: <RequireRole roles={['DEPT_MANAGER', 'ADMIN']} />,
                        children: [{ path: '/forbidden', element: <ForbiddenPage /> }],
                      },
                      {
                        element: <RequireRole roles={['ADMIN']} />,
                        children: [
                          { path: '/settings', element: <SettingsPage /> },
                          { path: '/settings/:tab', element: <SettingsPage /> },
                        ],
                      },
                    ],
                  },
                  // /requests/new보다 뒤에 둔다
                  { path: '/requests/:requestId', element: <RequestDetailPage />, handle: { back: { to: '/requests', label: '내 요청' } } },
                  { path: '*', element: <NotFoundPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
])
