import type { Task, TaskChangeItem, TaskContent, TaskExplanation, TaskType } from '../api/types'
import { parseUnifiedDiff } from './diff'

/**
 * 변경 내용을 사람이 읽는 문장으로 푼다.
 * 목 서버는 이 결과를 "AI 설명"으로 내려주고, 실제 백엔드가 설명을 주지 않으면 화면이 이 함수로 대신 만든다.
 */

export interface DiffStats {
  files: number
  added: number
  removed: number
}

export function diffStats(diff: string): DiffStats {
  const stats: DiffStats = { files: 0, added: 0, removed: 0 }
  for (const row of parseUnifiedDiff(diff)) {
    if (row.type === 'file') stats.files += 1
    if (row.type === 'line') {
      if (row.left?.kind === 'removed') stats.removed += 1
      if (row.right?.kind === 'added') stats.added += 1
    }
  }
  return stats
}

const NO_UNDO = '코드·DB·배포는 되돌리기 기능이 없습니다. 되돌리려면 새 요청으로 수정 작업을 만듭니다.'
const DOC_UNDO = '적용할 때마다 버전이 저장되어 이전 버전으로 되돌릴 수 있습니다.'

const AREAS: Array<{ match: RegExp; where: string; audience: string }> = [
  { match: /auth\/login/, where: '로그인 API (POST /login)', audience: '로그인하는 모든 사용자에게 적용됩니다' },
  { match: /auth\/session/, where: '세션 발급 로직', audience: '로그인한 모든 사용자의 세션에 적용됩니다' },
  { match: /auth\/token/, where: '토큰 서명 로직', audience: '이 토큰을 쓰는 모든 서비스가 영향을 받습니다' },
  { match: /auth\/users/, where: '사용자 조회 로직', audience: '로그인 과정 전체가 영향을 받습니다' },
  { match: /tests?\//, where: '자동 테스트', audience: '서비스 동작은 바뀌지 않습니다' },
  { match: /src\/(index|server)/, where: '서버 시작 코드', audience: '서비스 전체가 영향을 받습니다' },
  { match: /deploy\.sh/, where: '배포 스크립트', audience: '이 스크립트로 배포하는 모든 서비스가 영향을 받습니다' },
]

function areaFor(path: string) {
  return AREAS.find((area) => area.match.test(path)) ?? { where: path, audience: '이 파일을 쓰는 기능이 영향을 받습니다' }
}

const quoted = (text: string) => /['"`]([^'"`]+)['"`]/.exec(text)?.[1]

function describeFileChange(
  path: string,
  pairs: Array<{ before: string; after: string }>,
  added: string[],
  removed: number,
): TaskChangeItem {
  const { where } = areaFor(path)
  const pair = pairs[0]
  if (pair) {
    const ttlBefore = /60 \* (\d+)/.exec(pair.before)?.[1]
    const ttlAfter = /60 \* (\d+)/.exec(pair.after)?.[1]
    if (ttlBefore && ttlAfter) {
      return { where, what: '세션 유지 시간이 바뀝니다', before: `${ttlBefore}분`, after: `${ttlAfter}분` }
    }
    const textBefore = quoted(pair.before)
    const textAfter = quoted(pair.after)
    if (textBefore && textAfter && textBefore !== textAfter) {
      const isAlgorithm = /^sha\d+$/i.test(textBefore)
      return {
        where,
        what: isAlgorithm ? '서명 알고리즘이 바뀝니다' : '사용자에게 보이는 문구가 바뀝니다',
        before: textBefore,
        after: textAfter,
      }
    }
  }
  const testNames = added.flatMap((line) => /\bit\(['"`](.+?)['"`]/.exec(line)?.[1] ?? [])
  if (testNames.length > 0) {
    return { where, what: `테스트 ${testNames.length}개가 추가됩니다`, after: testNames.join(', ') }
  }
  const meaningful = added.filter((line) => line.trim() && !line.trim().startsWith('//'))
  if (added.length > 0 && meaningful.length === 0 && removed === 0) {
    return { where, what: '주석만 추가됩니다. 동작은 바뀌지 않습니다' }
  }
  if (removed === 0) return { where, what: `코드 ${added.length}줄이 추가됩니다` }
  return { where, what: `코드 ${added.length + removed}줄이 바뀝니다 (추가 ${added.length}, 삭제 ${removed})` }
}

/** 어떤 작업에나 붙는 설명은 요약으로 쓰지 않는다. */
const GENERIC_DESCRIPTION = /요청 내용에 맞춰|웹 코드 에디터에서 저장한|인증과 관련된 코드를/

function explainCode(title: string, target: string, diff: string, description?: string): TaskExplanation {
  const rows = parseUnifiedDiff(diff)
  const changes: TaskChangeItem[] = []
  let path = target
  let pairs: Array<{ before: string; after: string }> = []
  let added: string[] = []
  let removed = 0
  let hasChanges = false

  const flush = () => {
    if (hasChanges) changes.push(describeFileChange(path, pairs, added, removed))
    pairs = []
    added = []
    removed = 0
    hasChanges = false
  }

  for (const row of rows) {
    if (row.type === 'file') {
      flush()
      path = row.path
    }
    if (row.type !== 'line') continue
    const isRemoved = row.left?.kind === 'removed'
    const isAdded = row.right?.kind === 'added'
    if (isRemoved) removed += 1
    if (isAdded) added.push(row.right?.text ?? '')
    if (isRemoved && isAdded) pairs.push({ before: row.left?.text ?? '', after: row.right?.text ?? '' })
    if (isRemoved || isAdded) hasChanges = true
  }
  flush()

  const first = changes[0]
  const area = areaFor(target)
  const specific = description && !GENERIC_DESCRIPTION.test(description) ? description : null
  const summary = specific
    ? specific
    : first
    ? changes.length > 1
      ? `파일 ${changes.length}곳이 바뀝니다. ${first.where}: ${first.what}.`
      : `${first.where}에서 ${first.what}.`
    : `${title}: 바뀌는 코드가 없습니다.`

  return {
    summary,
    changes: changes.slice(0, 4),
    impact: [area.audience],
    undo: NO_UNDO,
  }
}

function explainDeploy(target: string, command: string): TaskExplanation {
  const production = /production|prod\b/i.test(command) || /production/i.test(target)
  const name = production ? '운영 서버' : '스테이징 서버'
  const force = /--force/.test(command)
  return {
    summary: `현재 코드를 ${name}에 배포합니다.`,
    changes: [
      { where: name, what: '서비스가 새 버전으로 교체됩니다. 3단계로 나눠 순차 재시작합니다' },
      ...(force ? [{ where: name, what: '검사를 건너뛰는 강제 옵션(--force)을 씁니다' }] : []),
    ],
    impact: production
      ? ['실제 사용자 전체에게 바로 적용됩니다']
      : ['스테이징을 쓰는 개발자와 QA가 잠시 영향을 받을 수 있습니다', '운영 서비스에는 영향이 없습니다'],
    undo: NO_UNDO,
  }
}

function explainQuery(type: TaskType, target: string, query: string): TaskExplanation {
  const addColumn = /ALTER TABLE (\w+) ADD COLUMN (\w+)/i.exec(query)
  if (addColumn) {
    const [, table, column] = addColumn
    return {
      summary: `${table} 테이블에 ${column} 칸(컬럼)이 새로 생깁니다.`,
      changes: [{ where: `${table} 테이블 (${target})`, what: `${column} 컬럼이 추가됩니다` }],
      impact: ['기존 데이터는 그대로 유지됩니다', '실행하는 동안 테이블이 잠깐 잠길 수 있습니다'],
      undo: NO_UNDO,
    }
  }
  const update = /UPDATE (\w+) SET (\w+)\s*=\s*'?([^'\s]+)'?(?:\s+WHERE (.+?))?;?$/im.exec(query)
  if (update) {
    const [, table, column, value, condition] = update
    return {
      summary: `${table} 테이블에서 조건에 맞는 행의 ${column} 값이 ${value}(으)로 바뀝니다.`,
      changes: [
        {
          where: `${table} 테이블 (${target})`,
          what: condition ? `조건: ${condition}` : '조건 없이 모든 행이 바뀝니다',
          after: `${column} = ${value}`,
        },
      ],
      impact: ['운영 데이터가 직접 바뀝니다', '바뀌는 행 수는 실행 전까지 알 수 없습니다'],
      undo: NO_UNDO,
    }
  }
  if (type === 'DATA_READ' || /^\s*SELECT/i.test(query)) {
    return {
      summary: `${target}에서 데이터를 읽기만 합니다. 아무것도 바뀌지 않습니다.`,
      changes: [{ where: target, what: '조회 쿼리를 한 번 실행합니다' }],
      impact: ['데이터는 바뀌지 않습니다', '조회 결과에 운영 데이터가 포함될 수 있습니다'],
      undo: '읽기만 하므로 되돌릴 것이 없습니다.',
    }
  }
  return {
    summary: `${target}에 쿼리를 실행합니다.`,
    changes: [{ where: target, what: '쿼리를 한 번 실행합니다' }],
    impact: ['데이터나 구조가 바뀔 수 있습니다'],
    undo: NO_UNDO,
  }
}

function explainDoc(title: string, target: string, body: string, previous?: string): TaskExplanation {
  const headings = (text: string) => [...text.matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1])
  const known = new Set(headings(previous ?? ''))
  const newHeadings = previous === undefined ? [] : headings(body).filter((h) => !known.has(h))
  const rollback = title.startsWith('문서 롤백')
  return {
    summary: rollback ? `${target} 문서를 이전 버전 내용으로 되돌립니다.` : `${target} 문서 내용이 바뀝니다.`,
    changes:
      newHeadings.length > 0
        ? newHeadings.map((heading) => ({ where: target, what: '새 항목이 추가됩니다', after: heading }))
        : [{ where: target, what: rollback ? '현재 내용이 선택한 버전으로 바뀝니다' : 'AI가 문서를 끝까지 작성했습니다' }],
    impact: ['문서만 바뀌고 서비스 동작에는 영향이 없습니다'],
    undo: DOC_UNDO,
  }
}

export function explainTask(input: {
  type: TaskType
  title: string
  target: string
  content: TaskContent
  /** AI가 쓴 작업 설명. 코드 작업이면 요약 문장으로 쓴다 */
  description?: string
  /** 문서 작업에서 기존 본문을 알면 넘긴다 */
  previousBody?: string
}): TaskExplanation {
  const { type, title, target, content, description, previousBody } = input
  if (content.diff !== undefined) return explainCode(title, target, content.diff, description)
  if (content.command !== undefined) return explainDeploy(target, content.command)
  if (content.query !== undefined) return explainQuery(type, target, content.query)
  if (content.body !== undefined) return explainDoc(title, target, content.body, previousBody)
  return { summary: title, changes: [], impact: [], undo: NO_UNDO }
}

/** 서버가 준 설명을 쓰고, 없으면 화면에서 만든다. */
export function explanationOf(task: Task): TaskExplanation {
  return task.explanation ?? explainTask(task)
}
