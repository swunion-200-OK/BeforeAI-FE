import type { ProgressNode, ProgressStreamEvent, ProgressTree } from '../api/types'

type NodePatchEvent = Extract<ProgressStreamEvent, { event: 'node.updated' }>

export function findProgressNode(node: ProgressNode, id: string): ProgressNode | null {
  if (node.id === id) return node
  if (!('children' in node)) return null
  for (const child of node.children) {
    const found = findProgressNode(child, id)
    if (found) return found
  }
  return null
}

/** 바뀐 노드까지의 경로만 새로 만든다. 나머지 노드는 그대로라 해당 노드만 다시 그려진다. */
function replaceNode(node: ProgressNode, id: string, change: (target: ProgressNode) => ProgressNode): ProgressNode {
  if (node.id === id) return change(node)
  if (!('children' in node)) return node
  let changed = false
  const children = node.children.map((child) => {
    const next = replaceNode(child, id, change)
    if (next !== child) changed = true
    return next
  })
  return changed ? ({ ...node, children } as ProgressNode) : node
}

/**
 * 스트림 이벤트 하나를 트리에 반영한다. 서버의 node.updated는 상태만 바꾼다.
 * 반영할 노드를 찾지 못하면 null이다. 버전만 올리면 그 변경을 잃으므로 호출한 쪽이 전체를 다시 받는다.
 */
export function applyProgressEvent(tree: ProgressTree, { id, data }: NodePatchEvent): ProgressTree | null {
  const root = replaceNode(tree.root, data.nodeId, (node) => ({ ...node, status: data.status }) as ProgressNode)
  if (root === tree.root) return null
  return { ...tree, version: id, root: root as ProgressTree['root'] }
}
