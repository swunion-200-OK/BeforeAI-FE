import { ApiError, errorMessage } from '../../api/errors'
import { toast } from '../../components/toast'

const NOT_DEPLOYED_NOTICE = '저장했지만 웹쉘에는 아직 반영하지 못했습니다. 서버가 자동으로 다시 보냅니다'

/** webshellApplied가 false면 저장만 된 것이다. 적용됐다고 말하지 않는다. */
export function notifyPolicySaved(message: string, webshellApplied: boolean) {
  if (webshellApplied) toast.success(message)
  else toast.info(NOT_DEPLOYED_NOTICE)
}

/**
 * 정책 변경 실패 처리. 웹쉘 배포만 실패한 502는 변경이 이미 저장된 것이라 같은 요청을 다시 보내면 안 된다
 * (details.mutationCommitted). 이때는 닫고 목록을 다시 읽는다. 쓰는 쪽 mutation에는 meta.silent를 준다.
 */
export function onPolicyError(onCommitted: () => unknown) {
  return (error: unknown) => {
    if (error instanceof ApiError && error.details.mutationCommitted === true) {
      toast.info(NOT_DEPLOYED_NOTICE)
      return onCommitted()
    }
    toast.error(errorMessage(error))
  }
}
