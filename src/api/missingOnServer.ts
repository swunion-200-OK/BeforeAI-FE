import { USE_MOCK } from './client'
import { ApiError } from './errors'

/**
 * 노션 명세에는 있는데 배포된 서버(OpenAPI)에 아직 없는 API 목록.
 * 기능을 지우지 않는다. 호출과 목은 그대로 두고, 실제 서버에서 없는 경로로 답하면 화면이 "아직 없는 기능"이라고 말한다.
 *
 * 서버에 생기면: 이 목록에서 지우고, endpoints.ts에서 그 호출의 whenOnServer를 벗긴다.
 * branches는 백엔드 저장소에서 구현을 찾은 브랜치다. 비어 있으면 어느 브랜치에도 없다.
 * 브랜치의 모양이 지금 호출과 다른 곳도 있으니 합칠 때 다시 맞춘다 (dashboard의 riskCounts, rollback의 taskIds·targetVersion).
 */
export const MISSING_ON_SERVER = [
  { operation: 'GET /me/notification-settings', screen: 'features/me/MePage', branches: [] },
  { operation: 'PUT /me/notification-settings', screen: 'features/me/MePage', branches: [] },
  { operation: 'PUT /admin/integrations/slack', screen: 'features/admin/SlackTab', branches: [] },
  { operation: 'PUT /projects/{projectId}/owners', screen: 'features/projects/OwnersModal', branches: [] },
  { operation: 'GET /requests/{requestId}/tasks/{taskId}/document', screen: 'components/TaskCard', branches: ['dev', 'feat/doc', 'feat/dashboard'] },
  { operation: 'POST /requests/{requestId}/rollback', screen: 'features/documents/DocumentsPage', branches: ['dev', 'feat/doc', 'feat/dashboard'] },
  { operation: 'GET /projects/{projectId}/documents', screen: 'features/documents/DocumentsPage', branches: ['dev', 'feat/doc', 'feat/dashboard'] },
  { operation: 'GET /documents/{documentId}/versions', screen: 'features/documents/DocumentsPage', branches: ['dev', 'feat/doc', 'feat/dashboard'] },
  { operation: 'GET /documents/{documentId}/versions/{version}', screen: 'features/documents/DocumentsPage', branches: ['dev', 'feat/doc', 'feat/dashboard'] },
  { operation: 'GET /dashboard', screen: 'features/dashboard/DashboardPage', branches: ['feat/dashboard'] },
  { operation: 'GET /audit-logs', screen: 'features/audit/AuditPage', branches: ['feat/dashboard'] },
  { operation: 'GET /audit-logs/{logId}', screen: 'features/audit/AuditDetailDrawer', branches: ['feat/dashboard'] },
  { operation: 'POST /audit-logs/exports', screen: 'features/audit/AuditExportModal', branches: ['feat/dashboard'] },
  { operation: 'GET /audit-logs/exports', screen: 'features/audit/AuditExportModal', branches: ['feat/dashboard'] },
  { operation: 'GET /audit-logs/exports/{exportId}', screen: 'features/audit/AuditExportModal', branches: ['feat/dashboard'] },
  { operation: 'GET /audit-logs/exports/{exportId}/file', screen: 'features/audit/AuditExportModal', branches: ['feat/dashboard'] },
] as const

export const MISSING_ON_SERVER_MESSAGE = '아직 서버에 없는 기능입니다'

export class MissingOnServerError extends ApiError {
  constructor(status: number) {
    super(status, 'MISSING_ON_SERVER', MISSING_ON_SERVER_MESSAGE)
    this.name = 'MissingOnServerError'
  }
}

export function isMissingOnServer(error: unknown): boolean {
  return error instanceof MissingOnServerError
}

/**
 * 목록에 있는 호출만 감싼다. 서버는 없는 경로에 404 NOT_FOUND로 답한다 (GlobalExceptionHandler).
 * 401이 아니므로 토큰 재발급도 로그아웃도 일어나지 않고, 코드가 있는 오류라 react-query도 다시 보내지 않는다.
 * 목은 이 API를 실제로 제공하므로, 목의 404는 "그런 문서가 없다" 같은 진짜 답이라 그대로 둔다.
 */
export function whenOnServer<T>(call: Promise<T>): Promise<T> {
  return call.catch((reason: unknown) => {
    if (!USE_MOCK && reason instanceof ApiError && (reason.status === 404 || reason.status === 405)) {
      throw new MissingOnServerError(reason.status)
    }
    throw reason
  })
}
