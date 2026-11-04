import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { Plan, PlanHashTarget } from '../api/types'

/** RFC 8785(JCS) 정규화. 키는 UTF-16 코드 단위 순서로 정렬한다. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
}

/** 명세 2.3의 해시 대상만 남긴다. 작업 상태처럼 실행 중 바뀌는 값은 넣지 않는다. */
export function toHashTarget(plan: Plan): PlanHashTarget {
  return {
    requestId: plan.requestId,
    planId: plan.id,
    projectId: plan.projectId,
    repository: plan.repository,
    baseCommit: plan.baseCommit,
    tasks: plan.tasks.map((t) => ({
      order: t.order,
      id: t.id,
      type: t.type,
      risk: t.risk,
      target: t.target,
      content: t.content,
    })),
  }
}

export const hashService = {
  /** Plan 원문을 JCS로 정규화해 SHA-256 해시를 만든다. */
  computePlanHash(plan: Plan): string {
    const canonical = canonicalize(toHashTarget(plan))
    return `sha256:${bytesToHex(sha256(new TextEncoder().encode(canonical)))}`
  },
}
