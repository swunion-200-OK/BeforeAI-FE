import { lazy } from 'react'
import { createBrowserRouter } from 'react-router'
import { AppShell } from './AppShell'
import { Root } from './Root'
import { HomeRedirect, RequireAuth, RequireInternal, RequireRole } from './guards'

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

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <HomeRedirect /> },
              // 외부망에서도 쓰는 화면 (기능 명세서 3.3)
              { path: '/requests', element: <RequestListPage /> },
              { path: '/approvals', element: <PendingListPage /> },
              { path: '/approvals/:requestId', element: <ApprovalDetailPage /> },
              { path: '/dashboard', element: <DashboardPage /> },
              { path: '/audit', element: <AuditPage /> },
              // 내부망 전용 화면
              {
                element: <RequireInternal />,
                children: [
                  { path: '/requests/new', element: <ComposePage /> },
                  { path: '/requests/new/:requestId', element: <ComposePage /> },
                  { path: '/editor', element: <EditorPage /> },
                  { path: '/editor/:projectId', element: <EditorPage /> },
                  { path: '/documents', element: <DocumentsPage /> },
                  { path: '/documents/:documentId', element: <DocumentsPage /> },
                  { path: '/projects', element: <ProjectsPage /> },
                  { path: '/projects/:projectId', element: <ProjectsPage /> },
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
              { path: '/requests/:requestId', element: <RequestDetailPage /> },
            ],
          },
        ],
      },
    ],
  },
])
