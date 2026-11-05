import type { ProjectSpec } from '../../api/types'

/** 복원본이 아니면 서버는 restoredFromVersion을 내려 주지 않는다 (SpecResponse). null과 빠진 값을 함께 거른다. */
export function restoredFromText(version: Pick<ProjectSpec, 'restoredFromVersion'>): string | null {
  return version.restoredFromVersion != null ? `v${version.restoredFromVersion}에서 복원` : null
}
