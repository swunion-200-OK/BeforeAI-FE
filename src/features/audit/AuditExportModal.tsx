import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { USE_MOCK } from '../../api/client'
import { ApiError, errorMessage } from '../../api/errors'
import { auditExportApi } from '../../api/endpoints'
import type { AuditExport, AuditExportAccepted, AuditLogQuery, ExportFormat, Role } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { toast } from '../../components/toast'
import { Banner, Button, Modal } from '../../components/ui'
import { EXPORT_FORMAT_LABEL } from '../../lib/labels'
import { useDepartments, useProjects } from '../../lib/queries'
import { describeConditions, exportFileName, exportMeta, exportSummary, rowCountText, timeText } from './auditExportView'

const POLL_MS = 1000

const SCOPE_LABEL: Record<Role, string> = {
  ADMIN: '회사 전체 기록',
  DEPT_MANAGER: '소속 부서 기록',
  EMPLOYEE: '본인 요청 기록',
}

const FORMATS: ExportFormat[] = ['XLSX', 'CSV']

function Conditions({ filters, actors }: { filters: AuditLogQuery; actors: Array<{ id: string; name: string }> }) {
  const me = useMe()
  const departments = useDepartments()
  const projects = useProjects()
  const applied = describeConditions(filters, { actors, departments: departments.data, projects: projects.data })
  const scope = SCOPE_LABEL[me.role]

  if (applied.length === 0) {
    return <p className="text-base text-ink">{scope}을 조건 없이 모두 내보냅니다.</p>
  }
  return (
    <div>
      <p className="text-base text-ink">{scope} 중 아래 조건에 맞는 기록을 내보냅니다.</p>
      <dl className="mt-3 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md bg-sheet-alt px-4 py-3 text-base">
        {applied.map(({ label, value }) => (
          <div key={label} className="contents">
            <dt className="text-ink-3">{label}</dt>
            <dd className="break-words text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function FormatPicker({ value, onChange }: { value: ExportFormat; onChange: (format: ExportFormat) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink-2">파일 형식</legend>
      <div className="grid grid-cols-2 gap-2">
        {FORMATS.map((id) => (
          <label
            key={id}
            className={`flex h-12 cursor-pointer items-center justify-center rounded-md border px-4 text-base font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-seal ${
              value === id ? 'border-seal bg-seal-soft font-semibold text-seal-dark ring-1 ring-seal' : 'border-rule-strong bg-sheet text-ink hover:bg-sheet-alt'
            }`}
          >
            <input
              type="radio"
              name="audit-export-format"
              className="sr-only"
              checked={value === id}
              onChange={() => onChange(id)}
            />
            {EXPORT_FORMAT_LABEL[id]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Processing({ rowCount }: { rowCount: number }) {
  return (
    <div className="flex flex-col gap-2 py-2" role="status">
      <p className="text-xl font-semibold text-ink">파일을 만들고 있습니다</p>
      <p className="text-base text-ink-2">{rowCountText(rowCount)}</p>
      <div className="my-1 h-1 w-full animate-pulse bg-seal motion-reduce:animate-none" role="progressbar" aria-label="파일 만드는 중" />
      <p className="text-sm text-ink-3">창을 닫아도 계속 만듭니다. {USE_MOCK ? '준비되면 Slack으로 알려 드립니다.' : '다시 열면 이어서 볼 수 있습니다.'}</p>
    </div>
  )
}

function Ready({ item }: { item: AuditExport }) {
  const expiry = timeText(item.expiresAt)
  return (
    <div className="flex flex-col gap-2 py-2">
      <p className="flex items-center gap-2 text-xl font-semibold text-ink">
        <CircleCheck size={22} className="shrink-0 text-low" aria-hidden />
        파일이 준비되었습니다
      </p>
      <p className="text-base text-ink-2">{exportSummary(item)}</p>
      {item.fileName && <p className="font-mono text-sm break-all text-ink-3">{item.fileName}</p>}
      {expiry && (
        <p className="mt-2 text-base text-ink">
          <strong className="font-semibold">{expiry}</strong>까지 내려받을 수 있습니다
        </p>
      )}
      <p className="text-sm text-ink-3">그 뒤에는 파일이 삭제됩니다. 요청한 본인만 내려받을 수 있습니다.</p>
    </div>
  )
}

function RecentExports({
  items,
  downloadingId,
  onDownload,
}: {
  items: AuditExport[]
  downloadingId: string | null
  onDownload: (item: AuditExport) => void
}) {
  return (
    <details className="group mt-5 border-t border-rule pt-4">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        최근 내보내기
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="mt-2 flex flex-col divide-y divide-rule">
        {items.map((item) => (
          <li key={item.exportId} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-base text-ink">{exportSummary(item)}</p>
              <p className="text-sm text-ink-3">{exportMeta(item)}</p>
            </div>
            {item.status === 'READY' && (
              <Button
                size="sm"
                internalOnly
                loading={downloadingId === item.exportId}
                aria-label={`${exportFileName(item)} 내려받기`}
                onClick={() => onDownload(item)}
              >
                내려받기
              </Button>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** 지금 표에 걸린 조건 그대로 파일을 만들어 내려받는다 (CORE-13). */
export function AuditExportModal({
  open,
  onClose,
  filters,
  actors,
}: {
  open: boolean
  onClose: () => void
  filters: AuditLogQuery
  actors: Array<{ id: string; name: string }>
}) {
  const queryClient = useQueryClient()
  const [format, setFormat] = useState<ExportFormat>('XLSX')
  const [accepted, setAccepted] = useState<AuditExportAccepted | null>(null)

  const create = useMutation({
    mutationFn: () => auditExportApi.create({ format, filters }),
    meta: { silent: true },
    onSuccess: (result) => {
      setAccepted(result)
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
      void queryClient.invalidateQueries({ queryKey: ['audit-exports'] })
    },
  })

  const current = useQuery({
    queryKey: ['audit-exports', 'detail', accepted?.exportId],
    queryFn: () => auditExportApi.get((accepted as AuditExportAccepted).exportId),
    enabled: Boolean(accepted),
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false
      return query.state.data && query.state.data.status !== 'PROCESSING' ? false : POLL_MS
    },
  })

  const recent = useQuery({
    queryKey: ['audit-exports', 'list'],
    queryFn: auditExportApi.list,
    enabled: open,
    refetchInterval: (query) => (query.state.data?.items.some((item) => item.status === 'PROCESSING') ? POLL_MS : false),
  })

  const download = useMutation({
    mutationFn: (item: AuditExport) => auditExportApi.download(item.exportId, exportFileName(item)),
    meta: { silent: true },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ['audit-exports'] })
      const expired = error instanceof ApiError && error.code === 'INVALID_STATE'
      toast.error(expired ? '파일이 만료되어 삭제되었습니다. 다시 만들어 주세요' : errorMessage(error))
    },
  })

  const startOver = () => {
    setAccepted(null)
    create.reset()
  }

  const status = accepted ? (current.data?.status ?? accepted.status) : null
  const processing = status === 'PROCESSING' && !current.isError

  // 만드는 중이면 닫았다 열어도 이어서 보여 주고, 그 밖에는 다음에 열 때 지금 조건으로 새로 시작한다.
  const close = () => {
    if (!processing) startOver()
    onClose()
  }

  const closeButton = (
    <Button size="lg" onClick={close}>
      닫기
    </Button>
  )

  let body
  let primary
  if (!accepted) {
    body = (
      <div className="flex flex-col gap-5">
        <Conditions filters={filters} actors={actors} />
        <FormatPicker
          value={format}
          onChange={(next) => {
            setFormat(next)
            create.reset()
          }}
        />
        {create.isError && <Banner tone="warning">{errorMessage(create.error)}</Banner>}
      </div>
    )
    primary = (
      <Button variant="primary" size="lg" internalOnly loading={create.isPending} onClick={() => create.mutate()}>
        파일 만들기
      </Button>
    )
  } else if (current.isError || status === 'FAILED' || status === 'EXPIRED') {
    body = (
      <Banner tone={status === 'EXPIRED' ? 'neutral' : 'danger'}>
        {current.isError
          ? errorMessage(current.error)
          : status === 'EXPIRED'
            ? '파일이 만료되어 삭제되었습니다. 다시 만들어 주세요.'
            : '파일을 만들지 못했습니다. 다시 시도해 주세요.'}
      </Banner>
    )
    primary = (
      <Button variant="primary" size="lg" internalOnly onClick={startOver}>
        다시 만들기
      </Button>
    )
  } else if (status === 'READY' && current.data) {
    // 명세의 상태 조회 응답에는 format이 없어 만들 때 받은 값으로 채운다.
    const item: AuditExport = { ...accepted, ...current.data }
    body = <Ready item={item} />
    primary = (
      <Button
        variant="primary"
        size="lg"
        internalOnly
        loading={download.isPending && download.variables?.exportId === item.exportId}
        onClick={() => download.mutate(item)}
      >
        내려받기
      </Button>
    )
  } else {
    body = <Processing rowCount={current.data?.rowCount ?? accepted.rowCount} />
    primary = (
      <Button variant="primary" size="lg" loading>
        파일 만드는 중
      </Button>
    )
  }

  const items = recent.data?.items ?? []

  return (
    <Modal
      open={open}
      title="감사 로그 내보내기"
      onClose={close}
      footer={
        <>
          {closeButton}
          {primary}
        </>
      }
    >
      {body}
      {items.length > 0 && (
        <RecentExports
          items={items}
          downloadingId={download.isPending ? (download.variables?.exportId ?? null) : null}
          onDownload={(item) => download.mutate(item)}
        />
      )}
    </Modal>
  )
}
