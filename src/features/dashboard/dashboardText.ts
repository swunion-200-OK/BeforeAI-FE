/**
 * 대시보드 첫 문장. 승인 서명은 내부망에서만 제출할 수 있어(ApprovalController),
 * 외부망에서 "승인할 요청이 있다"고 하면 할 수 없는 일을 시키는 말이 된다.
 */
export function dashboardHeadline({ myPending, external, attentionTotal, scopeName }: { myPending: number; external: boolean; attentionTotal: number; scopeName: string }): string {
  if (myPending > 0) return external ? `내부망에서 승인할 수 있는 요청 ${myPending}건이 있습니다.` : `승인할 요청 ${myPending}건이 있습니다.`
  if (attentionTotal > 0) return `확인이 필요한 요청 ${attentionTotal}건이 있습니다.`
  return `${scopeName} 현황입니다.`
}
