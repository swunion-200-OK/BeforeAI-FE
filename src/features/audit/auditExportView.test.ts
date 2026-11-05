// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { toAuditQuery } from './auditFilterParams'
import { describeConditions, exportFileName, exportMeta, exportSummary, rowCountText, timeText } from './auditExportView'

const shown = (search: string) => describeConditions(toAuditQuery(new URLSearchParams(search)), {})
const labels = (search: string) => shown(search).map((row) => row.label)

describe('보여 주는 조건 = 보내는 조건', () => {
  it.each([
    ['from=garbage', 'from'],
    ['to=garbage', 'to'],
    ['network=garbage', 'network'],
  ])('%s는 적용되지 않으므로 보여 주지 않는다', (search, key) => {
    const sent = toAuditQuery(new URLSearchParams(search))
    expect(sent[key as keyof typeof sent]).toBeUndefined()
    expect(labels(search)).toEqual([])
  })

  it('잘못된 값과 올바른 값이 섞이면 적용되는 쪽만 보여 준다', () => {
    expect(shown('from=garbage&to=2026-03-02&network=garbage&action=LOGIN')).toEqual([
      { label: '기간', value: '2026-03-02까지' },
      { label: '액션', value: '로그인' },
    ])
  })

  it('보내는 조건마다 한 줄씩 보여 주고 빠진 것이 없다', () => {
    const search = 'actorId=u-1&departmentId=d-1&projectId=p-1&requestId=r-1&action=LOGIN&network=EXTERNAL&from=2026-03-01&to=2026-03-02'
    const sent = toAuditQuery(new URLSearchParams(search))
    const rows = describeConditions(sent, {
      actors: [{ id: 'u-1', name: '홍길동' }],
      departments: [{ id: 'd-1', name: '백엔드팀' }],
      projects: [{ id: 'p-1', name: 'auth-service' }],
    })
    expect(rows).toEqual([
      { label: '기간', value: '2026-03-01 ~ 2026-03-02' },
      { label: '사용자', value: '홍길동' },
      { label: '부서', value: '백엔드팀' },
      { label: '프로젝트', value: 'auth-service' },
      { label: '요청 ID', value: 'r-1' },
      { label: '액션', value: '로그인' },
      { label: '접속 환경', value: '외부망' },
    ])
  })

  it('이름을 아직 모르면 보내는 ID를 그대로 보여 준다', () => {
    expect(shown('departmentId=d-9')).toEqual([{ label: '부서', value: 'd-9' }])
  })

  it('하루만 고르면 날짜 하나로 보여 준다', () => {
    expect(shown('from=2026-03-01&to=2026-03-01')).toEqual([{ label: '기간', value: '2026-03-01' }])
  })
})

describe('명세에 없는 값이 빠져도 화면이 깨지지 않는다', () => {
  it('createdAt이 없거나 잘못돼도 예외를 던지지 않는다', () => {
    expect(timeText(undefined)).toBeNull()
    expect(timeText(null)).toBeNull()
    expect(timeText('not-a-date')).toBeNull()
    expect(exportMeta({ status: 'READY' })).toBe('준비됨')
    expect(exportMeta({ status: 'READY', createdAt: 'not-a-date' })).toBe('준비됨')
    expect(exportMeta({ status: 'READY', createdAt: new Date().toISOString() })).toMatch(/^오늘 .* · 준비됨$/)
  })

  it('format과 rowCount가 없어도 있는 것만 보여 준다', () => {
    expect(rowCountText(undefined)).toBe('')
    expect(exportSummary({})).toBe('')
    expect(exportSummary({ rowCount: 1520 })).toBe('1,520건')
    expect(exportSummary({ format: 'XLSX' })).toBe('엑셀')
    expect(exportSummary({ format: 'CSV', rowCount: 0 })).toBe('CSV · 0건')
  })

  it('fileName이 없어도 내려받을 이름을 만든다', () => {
    expect(exportFileName({ exportId: 'e1', fileName: 'a.xlsx' })).toBe('a.xlsx')
    expect(exportFileName({ exportId: 'e1', format: 'CSV' })).toBe('audit-logs-e1.csv')
    expect(exportFileName({ exportId: 'e1' })).toBe('audit-logs-e1')
  })
})
