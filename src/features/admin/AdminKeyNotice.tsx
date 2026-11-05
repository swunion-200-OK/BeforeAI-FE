import { Link } from 'react-router'
import { useMe } from '../../app/AuthProvider'
import { Banner } from '../../components/ui'
import { NO_ADMIN_KEY_MESSAGE, adminKeyMissingReason } from '../../crypto/adminProof'

/** 정책 변경에는 이 기기의 승인 키가 있어야 한다. 눌러 보기 전에 화면에서 알린다. */
export function AdminKeyNotice() {
  const me = useMe()
  if (!adminKeyMissingReason(me.id)) return null
  return (
    <Banner
      tone="warning"
      title="관리자 승인 키가 필요합니다"
      action={
        <Link to="/me" className="font-medium underline">
          내 정보로 이동
        </Link>
      }
    >
      {NO_ADMIN_KEY_MESSAGE}
    </Banner>
  )
}
