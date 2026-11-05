import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { approvalDocumentApi } from '../../api/endpoints'
import { errorMessage } from '../../api/errors'
import type { RequestDetail, RequestStatus } from '../../api/types'
import { toast } from '../../components/toast'
import { Banner, Button, ErrorState, Select, Spinner } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { FOLD_LABEL } from '../requests/RequestDetailSections'
import {
  canShowPdf,
  documentHiddenReason,
  documentNote,
  documentWarning,
  downloadBlockedReason,
  isNoDocument,
  pdfViewerNotice,
  versionLabel,
} from './approvalDocumentView'

/** 받은 PDF마다 새 iframe을 쓴다. 쓰던 iframe의 주소를 바꾸면 브라우저 뒤로 가기 기록이 쌓인다. */
function PdfFrame({ blob, title, viewOnly }: { blob: Blob; title: string; viewOnly: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(blob)
    // 내려받을 수 없는 판은 보기 창의 저장 버튼을 숨긴다. 막는 장치가 아니라 안내에 맞추는 것이다.
    if (frame.current) frame.current.src = viewOnly ? `${url}#toolbar=0` : url
    return () => URL.revokeObjectURL(url)
  }, [blob, viewOnly])
  return <iframe ref={frame} title={title} className="h-[75vh] min-h-[32rem] w-full rounded-md border border-rule bg-sheet-alt" />
}

function NoDocument() {
  return <p className="py-2 text-base text-ink-2">아직 결재 문서가 없습니다.</p>
}

function DocumentPanel({
  requestId,
  requestStatus,
  revision,
  note,
}: {
  requestId: string
  requestStatus: RequestStatus
  revision: string
  note: string
}) {
  const [picked, setPicked] = useState<number | null>(null)
  const viewerReady = canShowPdf()

  const versions = useQuery({
    queryKey: ['approval-document', requestId, 'versions', revision],
    queryFn: () => approvalDocumentApi.versions(requestId),
  })
  const items = versions.data?.items ?? []
  const selected = items.find((item) => item.version === picked) ?? items[0]

  const pdf = useQuery({
    queryKey: ['approval-document', requestId, 'pdf', selected?.version, revision],
    // 최신 판도 번호로 받는다. 받는 사이 새 판이 생겨도 화면의 판 번호와 내용이 어긋나지 않는다.
    queryFn: ({ signal }) => approvalDocumentApi.version(requestId, selected.version, signal),
    enabled: Boolean(selected) && viewerReady,
    // 큰 파일이라 캐시에 남기지 않고, 창을 오가거나 다시 연결될 때 다시 받아 보던 자리를 잃지 않게 한다.
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const download = useMutation({
    mutationFn: () => approvalDocumentApi.download(requestId),
    meta: { silent: true },
    onError: (error) => {
      toast.error(errorMessage(error))
      void versions.refetch()
    },
  })

  if (versions.isPending) return <Spinner />
  // 다시 받기에 실패했을 뿐이면 이미 받은 목록을 그대로 쓴다.
  if (versions.isError && (!versions.data || isNoDocument(versions.error))) {
    return isNoDocument(versions.error) ? <NoDocument /> : <ErrorState error={versions.error} onRetry={() => versions.refetch()} />
  }
  if (!selected) return <NoDocument />

  const blockedReason = downloadBlockedReason(selected, requestStatus)
  const warning = documentWarning(requestStatus)
  const pdfGone = pdf.isError && isNoDocument(pdf.error)

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-rule bg-sheet p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {items.length > 1 ? (
          <Select
            aria-label="결재 문서 판"
            className="!w-auto"
            value={selected.version}
            onChange={(event) => setPicked(Number(event.target.value))}
          >
            {items.map((item) => (
              <option key={item.version} value={item.version}>
                {versionLabel(item, requestStatus)}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-base font-medium">{versionLabel(selected, requestStatus)}</p>
        )}
        <span className="text-sm text-ink-3">{formatDateTime(selected.createdAt)} 제출</span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {blockedReason && <span className="text-sm text-ink-3">{blockedReason}</span>}
          <Button size="sm" disabled={Boolean(blockedReason)} loading={download.isPending} onClick={() => download.mutate()}>
            PDF 내려받기
          </Button>
        </div>
      </div>

      {warning && <Banner tone="danger">{warning}</Banner>}

      {!viewerReady ? (
        <p className="py-2 text-base text-ink-2">{pdfViewerNotice(blockedReason)}</p>
      ) : pdf.data && !pdfGone ? (
        <>
          {pdf.isError && (
            <Banner
              tone="warning"
              action={
                <button type="button" className="font-medium underline" onClick={() => pdf.refetch()}>
                  다시 불러오기
                </button>
              }
            >
              최신 문서를 받지 못해 전에 받은 문서를 보여 줍니다.
            </Banner>
          )}
          <PdfFrame
            key={`${selected.version}-${pdf.dataUpdatedAt}-${Boolean(blockedReason)}`}
            blob={pdf.data}
            title={`승인 기록 문서 제 ${selected.version}판`}
            viewOnly={Boolean(blockedReason)}
          />
        </>
      ) : pdfGone ? (
        <NoDocument />
      ) : pdf.isError ? (
        <ErrorState error={pdf.error} onRetry={() => pdf.refetch()} />
      ) : (
        <Spinner />
      )}

      <p className="text-sm text-ink-3">{note}</p>
    </div>
  )
}

/** 접어 둔다. 펼칠 때만 PDF를 받고, 접으면 Blob URL을 놓는다. 프롬프트 요청만 결재 문서 대상이다. */
export function ApprovalDocumentSection({
  request,
  integrityFailed,
}: {
  request: Pick<RequestDetail, 'id' | 'source' | 'status' | 'approvals'>
  /** 승인 화면의 무결성 확인 결과. 확인을 거치지 않았으면 undefined */
  integrityFailed?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (request.source !== 'PROMPT') return null
  const hiddenReason = documentHiddenReason(integrityFailed)
  if (hiddenReason) {
    return (
      <section aria-label="결재 문서 미리보기">
        <p className="text-sm text-ink-2">{hiddenReason}</p>
      </section>
    )
  }
  // 도장이나 상태가 바뀌면 문서 내용도 바뀐다. updatedAt은 실행 중 이벤트마다 바뀔 수 있어 쓰지 않는다. 보던 PDF가 그때마다 다시 열린다.
  const revision = `${request.status}:${request.approvals.length}`
  return (
    <section aria-label="결재 문서 미리보기" className="flex flex-col items-start gap-2">
      <button type="button" aria-expanded={open} className={FOLD_LABEL} onClick={() => setOpen(!open)}>
        결재 문서 미리보기
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && <DocumentPanel requestId={request.id} requestStatus={request.status} revision={revision} note={documentNote(integrityFailed)} />}
    </section>
  )
}
