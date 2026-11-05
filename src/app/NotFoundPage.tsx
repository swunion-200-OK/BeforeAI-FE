import { Link } from 'react-router'
import { EmptyState } from '../components/ui'

/** 없는 주소. 앱 뼈대 안에 그려 메뉴가 남는다. 로그인 전이면 RequireAuth가 먼저 로그인으로 보낸다. */
export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <EmptyState
        title="찾을 수 없는 주소입니다"
        action={
          <Link to="/" className="font-medium text-seal underline">
            처음 화면으로
          </Link>
        }
      >
        주소가 바뀌었거나 없는 화면입니다.
      </EmptyState>
    </div>
  )
}
