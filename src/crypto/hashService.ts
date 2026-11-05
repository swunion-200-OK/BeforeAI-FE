import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { Plan, PlanHashTarget, Task, TaskContent } from '../api/types'

/**
 * RFC 8785(JCS) 정규화. 키는 UTF-16 코드 단위 순서로 정렬한다.
 * 서버 PlanHashService.canonicalize와 같은 바이트를 만든다. null은 지우지 않고 null로 쓴다.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
}

const CONTENT_FIELDS: Array<keyof TaskContent> = ['diff', 'command', 'query', 'body']

/** 서버 contentTarget과 같다. content가 없으면 빈 객체이고, null인 필드는 넣지 않는다. */
function toHashContent(content: TaskContent | null | undefined): TaskContent {
  const target: TaskContent = {}
  for (const field of CONTENT_FIELDS) {
    const value = content?.[field]
    if (value !== undefined && value !== null) target[field] = value
  }
  return target
}

/** 서버 hashTarget의 tasks와 같다. 금지 작업은 해시 대상이 아니고, 작업은 order 순이다. */
function toHashTasks(tasks: Task[]): PlanHashTarget['tasks'] {
  return tasks
    .filter((t) => t.risk !== 'FORBIDDEN')
    .sort((a, b) => a.order - b.order)
    .map((t) => ({
      order: t.order,
      id: t.id,
      type: t.type,
      risk: t.risk,
      target: t.target,
      content: toHashContent(t.content),
    }))
}

/** 명세 2.3의 해시 대상만 남긴다. 작업 상태처럼 실행 중 바뀌는 값은 넣지 않는다. projectId는 Plan에 없어 요청에서 받는다. */
export function toHashTarget(plan: Plan, projectId: string): PlanHashTarget {
  return {
    requestId: plan.requestId,
    planId: plan.id,
    projectId,
    repository: plan.repository,
    baseCommit: plan.baseCommit,
    tasks: toHashTasks(plan.tasks),
  }
}

function computeTargetHash(target: PlanHashTarget): string {
  return `sha256:${bytesToHex(sha256(new TextEncoder().encode(canonicalize(target))))}`
}

export const hashService = {
  /** 해시 대상을 JCS로 정규화해 SHA-256 해시를 만든다. 웹 서비스·승인자 기기·웹쉘이 같은 규칙으로 각자 계산한다. */
  computeTargetHash,

  computePlanHash(plan: Plan, projectId: string): string {
    return computeTargetHash(toHashTarget(plan, projectId))
  },

  /**
   * 화면에 보여 줄 Plan이 해시 대상과 같은 내용인지 본다. 제목과 설명은 해시 대상이 아니어서 비교하지 않는다.
   * 금지 작업은 서명 대상이 아니므로 뺀 뒤에 비교한다. 저장소와 기준 커밋은 Plan에 있을 때만 비교한다.
   */
  matchesHashTarget(plan: Pick<Plan, 'id' | 'tasks'> & Partial<Pick<Plan, 'requestId' | 'repository' | 'baseCommit'>>, target: PlanHashTarget): boolean {
    return (
      plan.id === target.planId &&
      (plan.requestId === undefined || plan.requestId === target.requestId) &&
      (plan.repository === undefined || plan.repository === target.repository) &&
      (plan.baseCommit === undefined || plan.baseCommit === target.baseCommit) &&
      canonicalize(toHashTasks(plan.tasks)) === canonicalize(target.tasks)
    )
  },
}
