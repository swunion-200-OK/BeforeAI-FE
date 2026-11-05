import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { Plan, PlanHashTarget, Task } from '../api/types'

/** RFC 8785(JCS) 정규화. 키는 UTF-16 코드 단위 순서로 정렬한다. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
}

function toHashTasks(tasks: Task[]): PlanHashTarget['tasks'] {
  return tasks.map((t) => ({
    order: t.order,
    id: t.id,
    type: t.type,
    risk: t.risk,
    target: t.target,
    content: t.content,
  }))
}

/** 명세 2.3의 해시 대상만 남긴다. 작업 상태처럼 실행 중 바뀌는 값은 넣지 않는다. */
export function toHashTarget(plan: Plan): PlanHashTarget {
  return {
    requestId: plan.requestId,
    planId: plan.id,
    projectId: plan.projectId,
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

  computePlanHash(plan: Plan): string {
    return computeTargetHash(toHashTarget(plan))
  },

  /** 화면에 보여 줄 Plan이 해시 대상과 같은 내용인지 본다. 제목과 설명은 해시 대상이 아니어서 비교하지 않는다. */
  matchesHashTarget(plan: Pick<Plan, 'id' | 'tasks'>, target: PlanHashTarget): boolean {
    return plan.id === target.planId && canonicalize(toHashTasks(plan.tasks)) === canonicalize(target.tasks)
  },
}
