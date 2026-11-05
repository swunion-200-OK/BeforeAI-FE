import type { ProgressNode, ProgressStreamEvent, ProgressTree } from '../api/types'

type NodePatchEvent = Extract<ProgressStreamEvent, { event: 'node.updated' | 'node.added' }>

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
 * 스트림 이벤트 하나를 트리에 반영한다. 값이 null인 속성은 지운다 (승인되면 candidates가 없어지는 경우).
 * 반영할 노드를 찾지 못하면 null이다. 버전만 올리면 그 변경을 잃으므로 호출한 쪽이 전체를 다시 받는다.
 */
export function applyProgressEvent(tree: ProgressTree, { id, event, data }: NodePatchEvent): ProgressTree | null {
  const root =
    event === 'node.added'
      ? replaceNode(tree.root, data.parentId, (parent) =>
          'children' in parent ? ({ ...parent, children: [...parent.children, data.node] } as ProgressNode) : parent,
        )
      : replaceNode(tree.root, data.nodeId, (node) => {
          const { nodeId: _nodeId, at, ...fields } = data
          const merged: Record<string, unknown> = { ...node }
          for (const [key, value] of Object.entries(fields)) {
            if (value === null) delete merged[key]
            else merged[key] = value
          }
          // 승인 노드의 at은 승인 시각이다. 다른 노드의 at은 바뀐 시각일 뿐 트리에 남기지 않는다.
          if (node.type === 'APPROVAL') merged.at = at
          return merged as unknown as ProgressNode
        })
  if (root === tree.root) return null
  return { ...tree, version: id, root: root as ProgressTree['root'] }
}
