import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clock,
  Lock,
  Maximize2,
  Play,
  SkipForward,
  X,
  type LucideIcon,
} from 'lucide-react'
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Link, useMatch } from 'react-router'
import { approvalsApi } from '../../api/endpoints'
import type {
  ApprovalNodeStatus,
  ProgressApprovalNode,
  ProgressNode,
  ProgressPlanNode,
  ProgressRequestNode,
  ProgressStepNode,
  ProgressTaskNode,
  RequestStatus,
  StepStatus,
  TaskStatus,
} from '../../api/types'
import { LogViewer } from '../../components/LogViewer'
import { NetworkBadge, RiskBadge } from '../../components/badges'
import { KeyValues } from '../../components/rich'
import { TaskContentView } from '../../components/TaskCard'
import { Button, ErrorState, Mono, Spinner } from '../../components/ui'
import { formatDateTime, formatElapsed } from '../../lib/format'
import { REQUEST_STATUS_LABEL, RULE_LABEL, TASK_STATUS_LABEL, TASK_TYPE_LABEL } from '../../lib/labels'
import { findProgressNode } from '../../lib/progressTree'
import { useRequest } from '../../lib/queries'
import { candidateNames, GATE_ID, gateView, pathIds, progressNow, type GateView, type PathMode, type ProgressNow } from './progressStatus'
import { useGateReplay } from './useGateReplay'
import { useProgressTree } from './useProgressTree'
import { WebshellGate } from './WebshellGate'

/** 상태 색상 (기능 명세서 5.12): 대기 회색, 승인됨 파랑, 실행중 노랑(움직임), 성공 초록, 실패 빨강, 금지 검정, 건너뜀 연회색 */
type Tone = 'wait' | 'approved' | 'running' | 'success' | 'failed' | 'forbidden' | 'skipped'

const TONE_OF_STATUS: Record<RequestStatus | TaskStatus | StepStatus | ApprovalNodeStatus, Tone> = {
  ANALYZING: 'wait',
  REVIEWING: 'wait',
  PENDING_APPROVAL: 'wait',
  REAPPROVAL_REQUIRED: 'wait',
  PENDING: 'wait',
  APPROVED: 'approved',
  RUNNING: 'running',
  ROLLING_BACK: 'running',
  SUCCEEDED: 'success',
  COMPLETED: 'success',
  ROLLED_BACK: 'success',
  ANALYSIS_FAILED: 'failed',
  VERIFICATION_FAILED: 'failed',
  REJECTED: 'failed',
  KILLED: 'failed',
  PARTIALLY_COMPLETED: 'failed',
  FAILED: 'failed',
  ROLLBACK_FAILED: 'failed',
  BLOCKED: 'forbidden',
  SKIPPED: 'skipped',
  CANCELED: 'skipped',
}

/** 모르는 상태값이 와도 화면이 깨지지 않게 대기로 본다 */
const toneOf = (status: string): Tone => TONE_OF_STATUS[status as keyof typeof TONE_OF_STATUS] ?? 'wait'

const TONE_STYLE: Record<Tone, { band: string; border: string; softBorder: string; softBg: string; ink: string; Icon: LucideIcon }> = {
  wait: {
    band: 'bg-flow-wait text-white',
    border: 'border-flow-wait',
    softBorder: 'border-flow-wait/40',
    softBg: 'bg-flow-wait-soft',
    ink: 'text-flow-wait-ink',
    Icon: Clock,
  },
  approved: {
    band: 'bg-seal text-white',
    border: 'border-seal',
    softBorder: 'border-seal/40',
    softBg: 'bg-seal-soft',
    ink: 'text-seal-dark',
    Icon: CircleCheck,
  },
  running: {
    band: 'bg-flow-run-band text-flow-run-ink',
    border: 'border-flow-run',
    softBorder: 'border-flow-run',
    softBg: 'bg-flow-run-soft',
    ink: 'text-flow-run-ink',
    Icon: Play,
  },
  success: {
    band: 'bg-low text-white',
    border: 'border-low',
    softBorder: 'border-low/40',
    softBg: 'bg-low-soft',
    ink: 'text-low',
    Icon: CircleCheck,
  },
  failed: {
    band: 'bg-high text-white',
    border: 'border-high',
    softBorder: 'border-high/40',
    softBg: 'bg-high-soft',
    ink: 'text-[#a81f16]',
    Icon: CircleX,
  },
  forbidden: {
    band: 'bg-black text-white',
    border: 'border-black',
    softBorder: 'border-black',
    softBg: 'bg-black',
    ink: 'text-white',
    Icon: Lock,
  },
  skipped: {
    band: 'bg-flow-skip text-flow-skip-ink',
    border: 'border-flow-skip',
    softBorder: 'border-flow-skip',
    softBg: 'bg-flow-skip-soft',
    ink: 'text-flow-skip-ink',
    Icon: SkipForward,
  },
}

const APPROVAL_WORD: Record<ApprovalNodeStatus, string> = { PENDING: '승인 대기', APPROVED: '승인', REJECTED: '거부' }
const STEP_WORD: Record<StepStatus, string> = { RUNNING: '실행 중', SUCCEEDED: '성공', FAILED: '실패', SKIPPED: '건너뜀' }

const SELECTED = 'ring-[3px] ring-seal ring-offset-2 ring-offset-sheet'
const shortPlanHash = (hash: string) => `${hash.replace(/^sha256:/, '').slice(0, 4)}…`

function candidatesText(node: ProgressApprovalNode): string {
  const names = candidateNames(node)
  if (names.length > 0) return names.join(' 또는 ')
  return node.rule ? (RULE_LABEL[node.rule] ?? '') : ''
}

interface NodeActions {
  selectedId: string | null
  onSelect: (id: string) => void
  panelId: string
  /** 지금 진행 중인 경로가 있으면 그 경로 밖의 노드는 테두리를 낮춘다. 내용은 그대로 읽힌다 */
  isQuiet: (id: string) => boolean
  isOnPath: (id: string) => boolean
}

/** 경로 위 말단 노드(승인·단계)는 굵은 테두리, 경로 밖은 옅은 테두리, 나머지는 평소대로 */
function softFrame(tone: Tone, quiet: boolean, onPath: boolean): string {
  const { border, softBorder, softBg } = TONE_STYLE[tone]
  if (quiet) return `border border-rule-strong ${softBg}`
  return onPath ? `border-2 ${border} ${softBg}` : `border ${softBorder} ${softBg}`
}

// ── 노드 ──────────────────────────────────────────────────

function StatusBand({ tone, word }: { tone: Tone; word: string }) {
  const { band, Icon } = TONE_STYLE[tone]
  return (
    <span className={`flex items-center gap-1.5 px-3 py-1 text-sm font-semibold ${band}`}>
      <Icon size={15} aria-hidden />
      {word}
    </span>
  )
}

function RequestNode({ node }: { node: ProgressRequestNode }) {
  const tone = toneOf(node.status)
  return (
    <div data-node-id={node.id} className={`w-full max-w-[28rem] overflow-hidden rounded-lg border-2 bg-sheet [contain:inline-size] ${TONE_STYLE[tone].border}`}>
      <StatusBand tone={tone} word={REQUEST_STATUS_LABEL[node.status]} />
      <p className="line-clamp-2 px-4 py-2.5 leading-snug font-semibold" title={node.label}>
        {node.label}
      </p>
    </div>
  )
}

function CurrentPlanNode({ node }: { node: ProgressPlanNode }) {
  return (
    <div data-node-id={node.id} className="flex items-center gap-3 rounded-full border-2 border-ink bg-sheet px-5 py-1.5">
      <span className="font-semibold">{node.label}</span>
      {node.planHash && <span className="font-mono text-xs text-ink-3">해시 {shortPlanHash(node.planHash)}</span>}
      <span className="text-sm font-semibold text-ink-2">현재</span>
    </div>
  )
}

function SupersededPlanNode({ node, expanded, onToggle }: { node: ProgressPlanNode; expanded: boolean; onToggle: (id: string) => void }) {
  return (
    <button
      type="button"
      data-node-id={node.id}
      aria-expanded={expanded}
      onClick={() => onToggle(node.id)}
      className="flex items-center gap-3 rounded-full border-2 border-dashed border-ink-3 bg-sheet px-5 py-1.5 text-ink-2 hover:bg-sheet-alt"
    >
      <span className="font-semibold">{node.label}</span>
      {node.planHash && <span className="font-mono text-xs text-ink-3">해시 {shortPlanHash(node.planHash)}</span>}
      <span className="text-sm font-medium">{expanded ? '대체됨(펼침)' : '대체됨(접힘)'}</span>
      <ChevronDown size={15} aria-hidden className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
  )
}

function SupersededTasks({ node }: { node: ProgressPlanNode }) {
  return (
    <ul className="flex w-[17rem] flex-col gap-2">
      {node.supersededAt && <li className="ml-7 text-xs text-ink-3">{formatDateTime(node.supersededAt)}에 대체됨</li>}
      {!node.supersededTasks?.length && <li className="ml-7 text-sm text-ink-2">이 Plan의 자세한 내용은 없습니다.</li>}
      {node.supersededTasks?.map((task, index) => (
        <li
          key={task.label}
          data-node-id={`${node.id}#${index}`}
          className="ml-7 rounded-md border-2 border-dashed border-rule-strong bg-sheet px-3 py-2"
        >
          <p className="text-sm leading-snug font-medium text-ink-2">{task.label}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            {TASK_TYPE_LABEL[task.taskType]}
            {task.risk && <RiskBadge risk={task.risk} />}
          </p>
        </li>
      ))}
    </ul>
  )
}

const TaskNode = memo(function TaskNode({
  node,
  selected,
  onSelect,
  panelId,
  after,
  quiet,
}: {
  node: ProgressTaskNode
  selected: boolean
  onSelect: (id: string) => void
  panelId: string
  after: string
  quiet: boolean
}) {
  const tone = toneOf(node.status)
  return (
    <button
      type="button"
      data-node-id={node.id}
      aria-expanded={selected}
      aria-controls={panelId}
      onClick={() => onSelect(node.id)}
      data-quiet={quiet || undefined}
      className={`block w-full overflow-hidden rounded-lg border-2 bg-sheet text-left hover:shadow-raised ${quiet ? 'border-rule-strong' : `shadow-card ${TONE_STYLE[tone].border}`} ${selected ? SELECTED : ''}`}
    >
      <StatusBand tone={tone} word={TASK_STATUS_LABEL[node.status]} />
      <span className="block px-3 pt-2.5 pb-3">
        <span className="block leading-snug font-semibold">{node.label}</span>
        <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
          {TASK_TYPE_LABEL[node.taskType]}
          {node.risk && <RiskBadge risk={node.risk} />}
        </span>
        {after && <span className="sr-only">선행 작업: {after}</span>}
      </span>
    </button>
  )
})

const ApprovalNode = memo(function ApprovalNode({
  node,
  selected,
  onSelect,
  panelId,
  quiet,
  onPath,
}: {
  node: ProgressApprovalNode
  selected: boolean
  onSelect: (id: string) => void
  panelId: string
  quiet: boolean
  onPath: boolean
}) {
  const tone = toneOf(node.status)
  const { ink } = TONE_STYLE[tone]
  const pending = node.status === 'PENDING'
  return (
    <button
      type="button"
      data-node-id={node.id}
      aria-expanded={selected}
      aria-controls={panelId}
      onClick={() => onSelect(node.id)}
      data-quiet={quiet || undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:shadow-card ${softFrame(tone, quiet, onPath)} ${selected ? SELECTED : ''}`}
    >
      {pending ? (
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-flow-wait text-flow-wait">
          <Clock size={16} />
        </span>
      ) : (
        <span
          aria-hidden
          className={`flex size-10 shrink-0 -rotate-6 items-center justify-center rounded-full border-2 bg-sheet text-[0.65rem] leading-none font-bold tracking-tight ${
            node.status === 'REJECTED' ? 'border-high text-high' : 'border-seal text-seal'
          }`}
        >
          {node.label ?? APPROVAL_WORD[node.status]}
        </span>
      )}
      <span className="min-w-0">
        <span className={`block text-sm font-semibold ${ink}`}>{APPROVAL_WORD[node.status]}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-snug text-ink-2">
          {pending ? candidatesText(node) : node.label}
          {node.network && <NetworkBadge network={node.network} />}
        </span>
      </span>
    </button>
  )
})

const StepNode = memo(function StepNode({
  node,
  selected,
  onSelect,
  panelId,
  quiet,
  onPath,
}: {
  node: ProgressStepNode
  selected: boolean
  onSelect: (id: string) => void
  panelId: string
  quiet: boolean
  onPath: boolean
}) {
  const tone = toneOf(node.status)
  const { ink, Icon } = TONE_STYLE[tone]
  return (
    <button
      type="button"
      data-node-id={node.id}
      aria-expanded={selected}
      aria-controls={panelId}
      onClick={() => onSelect(node.id)}
      data-quiet={quiet || undefined}
      className={`block w-full overflow-hidden rounded-lg text-left hover:shadow-card ${softFrame(tone, quiet, onPath)} ${selected ? SELECTED : ''}`}
    >
      {node.status === 'RUNNING' && <span aria-hidden className="flow-running block h-1.5" />}
      <span className={`flex items-center gap-1 px-2.5 pt-1.5 text-sm font-semibold ${ink}`}>
        <Icon size={14} aria-hidden />
        {STEP_WORD[node.status]}
      </span>
      <span className="line-clamp-2 px-2.5 pt-0.5 pb-2 font-mono text-xs [overflow-wrap:anywhere] text-ink" title={node.label}>
        {node.label}
      </span>
    </button>
  )
})

/** 작업 한 칸. 승인 줄과 단계 줄이 옆 작업과 맞도록 격자에 줄 번호로 놓는다. 3번째 줄이 웹쉘 검증 관문이다. */
function TaskColumn({
  node,
  actions,
  after,
  column,
  cutBelow,
}: {
  node: ProgressTaskNode
  actions: NodeActions
  after: string
  column: number
  /** 검증 실패로 이 작업이 실행되지 않았다 */
  cutBelow: boolean
}) {
  const { selectedId, onSelect, panelId, isQuiet } = actions
  const approvals = node.children.filter((child) => child.type === 'APPROVAL')
  const steps = node.children.filter((child) => child.type === 'STEP')
  const onPath = actions.isOnPath
  return (
    <>
      <div style={{ gridColumn: column, gridRow: 1 }}>
        <TaskNode node={node} selected={selectedId === node.id} onSelect={onSelect} panelId={panelId} after={after} quiet={isQuiet(node.id)} />
      </div>
      {approvals.length > 0 && (
        <div style={{ gridColumn: column, gridRow: 2 }} className="ml-7 flex flex-col gap-2">
          {approvals.map((child) => (
            <ApprovalNode key={child.id} node={child} selected={selectedId === child.id} onSelect={onSelect} panelId={panelId} quiet={isQuiet(child.id)} onPath={onPath(child.id)} />
          ))}
        </div>
      )}
      {(steps.length > 0 || cutBelow) && (
        <div style={{ gridColumn: column, gridRow: 4 }} className="ml-7 flex flex-col gap-2">
          {steps.map((child) => (
            <StepNode key={child.id} node={child} selected={selectedId === child.id} onSelect={onSelect} panelId={panelId} quiet={isQuiet(child.id)} onPath={onPath(child.id)} />
          ))}
          {cutBelow && steps.length === 0 && (
            <p data-node-id={`${node.id}#cut`} className="rounded-lg border-2 border-dashed border-high/60 bg-sheet px-2.5 py-2 text-sm font-semibold text-high">
              실행 안 됨
            </p>
          )}
        </div>
      )}
    </>
  )
}

// ── 연결선 ────────────────────────────────────────────────

type LinkKind = 'branch' | 'branchDashed' | 'leaf' | 'leafDashed' | 'arrow' | 'arrowOver' | 'toGate' | 'gateLeaf' | 'gateCut'

interface Link {
  from: string
  to: string
  kind: LinkKind
  /** 관문 아래 선은 관문이 넓어도 그 작업의 줄기에서 내려간다 */
  task?: string
}

interface Connector extends Link {
  key: string
  d: string
  /** 선행 작업 화살표 위에 쓰는 글자 자리 */
  labelAt?: { x: number; y: number }
}

function linksOf(root: ProgressRequestNode, expanded: ReadonlySet<string>, gateClosed: boolean): Link[] {
  const links: Link[] = []
  for (const child of root.children) {
    if (child.type !== 'PLAN') continue
    const superseded = child.status === 'SUPERSEDED'
    links.push({ from: root.id, to: child.id, kind: superseded ? 'branchDashed' : 'branch' })
    if (superseded && expanded.has(child.id)) {
      child.supersededTasks?.forEach((_, index) => links.push({ from: child.id, to: `${child.id}#${index}`, kind: 'leafDashed' }))
    }
    const order = child.children.map((task) => task.id)
    for (const task of child.children) {
      if (task.type !== 'TASK') continue
      links.push({ from: child.id, to: task.id, kind: 'branch' })
      const blocked = task.status === 'BLOCKED'
      if (!superseded && !blocked) links.push({ from: task.id, to: GATE_ID, kind: 'toGate' })
      let hasStep = false
      for (const leaf of task.children) {
        if (leaf.type === 'STEP') {
          hasStep = true
          links.push({ from: GATE_ID, to: leaf.id, kind: 'gateLeaf', task: task.id })
        } else {
          links.push({ from: task.id, to: leaf.id, kind: 'leaf' })
        }
      }
      if (gateClosed && !blocked && !hasStep) links.push({ from: GATE_ID, to: `${task.id}#cut`, kind: 'gateCut', task: task.id })
      for (const dependency of task.dependsOn) {
        // 바로 옆 작업이 아니면 사이의 작업을 지나지 않도록 위로 돌아간다.
        const adjacent = order.indexOf(task.id) - order.indexOf(dependency) === 1
        links.push({ from: dependency, to: task.id, kind: adjacent ? 'arrow' : 'arrowOver' })
      }
    }
  }
  return links
}

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number }

function elbow(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(x1 - x2) < 1) return `M${x1} ${y1}V${y2}`
  const midY = (y1 + y2) / 2
  const direction = x2 > x1 ? 1 : -1
  const r = Math.min(10, Math.abs(x2 - x1) / 2, (y2 - y1) / 2)
  return `M${x1} ${y1}V${midY - r}Q${x1} ${midY} ${x1 + direction * r} ${midY}H${x2 - direction * r}Q${x2} ${midY} ${x2} ${midY + r}V${y2}`
}

function leafPath(trunk: number, top: number, b: Box): string {
  const y = b.top + Math.min(b.height / 2, 24)
  return `M${trunk} ${top}V${y - 8}Q${trunk} ${y} ${trunk + 8} ${y}H${b.left}`
}

function connectorOf(link: Link, a: Box, b: Box, task?: Box): Connector {
  const key = `${link.kind}:${link.from}>${link.to}`
  const base = { ...link, key }
  switch (link.kind) {
    case 'branch':
    case 'branchDashed':
      return { ...base, d: elbow(a.left + a.width / 2, a.bottom, b.left + b.width / 2, b.top) }
    case 'leaf':
    case 'leafDashed':
      return { ...base, d: leafPath(a.left + 14, a.bottom, b) }
    case 'toGate': {
      const trunk = a.left + 14
      return { ...base, d: `M${trunk} ${a.bottom}V${b.top}` }
    }
    case 'gateLeaf':
    case 'gateCut':
      return { ...base, d: leafPath((task ?? a).left + 14, a.bottom, b) }
    case 'arrow': {
      const y = a.top + Math.min(a.height, b.height) / 2
      return { ...base, d: `M${a.right} ${y}H${b.left - 2}`, labelAt: { x: (a.right + b.left) / 2, y: y - 9 } }
    }
    case 'arrowOver': {
      const lane = a.top - 12
      const x1 = a.right - a.width / 4
      const x2 = b.left + b.width / 4
      return { ...base, d: `M${x1} ${a.top}V${lane}H${x2}V${b.top - 2}`, labelAt: { x: (x1 + x2) / 2, y: lane - 5 } }
    }
  }
}

/** 노드 위치를 재서 연결선을 그린다. 노드가 커지거나 트리가 바뀌면 다시 잰다. */
function useConnectors(hostRef: RefObject<HTMLDivElement | null>, links: Link[], zoom: number): Connector[] {
  const [connectors, setConnectors] = useState<Connector[]>([])
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const nodes = () => host.querySelectorAll<HTMLElement>('[data-node-id]')
    const measure = () => {
      const origin = host.getBoundingClientRect()
      const boxes = new Map<string, Box>()
      nodes().forEach((element) => {
        const rect = element.getBoundingClientRect()
        // 크게 보기는 CSS zoom을 쓴다. 화면 좌표를 SVG 안의 좌표로 되돌린다.
        boxes.set(element.dataset.nodeId as string, {
          left: (rect.left - origin.left) / zoom,
          right: (rect.right - origin.left) / zoom,
          top: (rect.top - origin.top) / zoom,
          bottom: (rect.bottom - origin.top) / zoom,
          width: rect.width / zoom,
          height: rect.height / zoom,
        })
      })
      const next = links.flatMap((link) => {
        const a = boxes.get(link.from)
        const b = boxes.get(link.to)
        return a && b ? [connectorOf(link, a, b, link.task ? boxes.get(link.task) : undefined)] : []
      })
      setConnectors((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    nodes().forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [hostRef, links, zoom])
  return connectors
}

const CONNECTOR_CLASS: Record<LinkKind, string> = {
  branch: 'stroke-ink-3 [stroke-width:2]',
  branchDashed: 'stroke-ink-3 [stroke-width:2] [stroke-dasharray:6_5]',
  leaf: 'stroke-ink-3 [stroke-width:1.5]',
  leafDashed: 'stroke-ink-3 [stroke-width:1.5] [stroke-dasharray:4_4]',
  arrow: 'stroke-ink [stroke-width:4]',
  arrowOver: 'stroke-ink [stroke-width:4]',
  toGate: 'stroke-ink-3 [stroke-width:1.5]',
  gateLeaf: 'stroke-ink-3 [stroke-width:1.5]',
  gateCut: 'stroke-high [stroke-width:2] [stroke-dasharray:5_5]',
}

/** 경로가 될 수 있는 선 */
const PATH_KINDS: LinkKind[] = ['branch', 'leaf', 'toGate', 'gateLeaf']
const PATH_CLASS: Record<PathMode, string> = {
  wait: 'stroke-ink [stroke-width:4]',
  running: 'stroke-ink [stroke-width:4]',
  failed: 'stroke-high [stroke-width:4]',
}
/** 기다리는 길은 천천히, 실행 중인 길은 빠르게 흐른다. 실패한 길에는 움직임이 없다 */
const PULSE_CLASS: Partial<Record<PathMode, string>> = {
  wait: 'flow-pulse flow-pulse-wait stroke-white [stroke-width:4]',
  running: 'flow-pulse stroke-[#ffd93b] [stroke-width:4]',
}

// ── 도식 ──────────────────────────────────────────────────

function Diagram({
  root,
  actions,
  expanded,
  onTogglePlan,
  gate,
  gateLit,
  path,
  zoom,
}: {
  root: ProgressRequestNode
  actions: NodeActions
  expanded: ReadonlySet<string>
  onTogglePlan: (id: string) => void
  gate: GateView | null
  gateLit: number | null
  path: { ids: ReadonlySet<string>; mode: PathMode | null }
  zoom: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  // 관문이 닫히는 장면이 끝나기 전에는 선을 자르지 않는다.
  const gateClosed = gate?.phase === 'failed' && gateLit === null
  const links = useMemo(() => linksOf(root, expanded, gateClosed), [root, expanded, gateClosed])
  const connectors = useConnectors(hostRef, links, zoom)
  const arrowId = useId()
  const plans = root.children.filter((child): child is ProgressPlanNode => child.type === 'PLAN')
  const onPath = (connector: Connector) =>
    path.mode !== null && PATH_KINDS.includes(connector.kind) && path.ids.has(connector.from) && path.ids.has(connector.to)
  const pathConnectors = connectors.filter(onPath)
  const pulse = path.mode && PULSE_CLASS[path.mode]
  return (
    <div className="flow-canvas quiet-scroll overflow-x-auto rounded-xl border border-rule">
      <div ref={hostRef} className="relative w-max min-w-full p-7">
        <svg aria-hidden className="pointer-events-none absolute inset-0 size-full fill-none">
          <defs>
            <marker id={arrowId} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto">
              <path d="M0 0 10 5 0 10z" className="fill-ink" />
            </marker>
          </defs>
          {connectors.map((connector) => (
            <path
              key={connector.key}
              d={connector.d}
              className={CONNECTOR_CLASS[connector.kind]}
              markerEnd={connector.labelAt ? `url(#${arrowId})` : undefined}
              data-link={connector.kind}
              data-from={connector.from}
              data-to={connector.to}
            />
          ))}
          {path.mode &&
            pathConnectors.map((connector) => (
              <path key={`path:${connector.key}`} d={connector.d} className={PATH_CLASS[path.mode as PathMode]} data-active-link={path.mode} data-from={connector.from} data-to={connector.to} />
            ))}
          {pulse && pathConnectors.map((connector) => <path key={`pulse:${connector.key}`} d={connector.d} className={pulse} data-pulse />)}
          {connectors.map(
            (connector) =>
              connector.labelAt && (
                <text
                  key={connector.key}
                  x={connector.labelAt.x}
                  y={connector.labelAt.y}
                  textAnchor="middle"
                  className="fill-ink-2 text-[0.72rem] font-semibold"
                >
                  선행 작업
                </text>
              ),
          )}
        </svg>
        <div className="relative flex flex-col items-center gap-12">
          <RequestNode node={root} />
          {plans.length > 0 && (
            <div className="flex w-full items-start justify-center gap-14">
              {plans.map((plan) =>
                plan.status === 'CURRENT' ? (
                  <div key={plan.id} className="flex flex-1 flex-col items-center gap-12">
                    <CurrentPlanNode node={plan} />
                    {plan.children.length > 0 && (
                      <TaskGrid plan={plan} actions={actions} gate={gate} gateLit={gateLit} gateClosed={gateClosed} />
                    )}
                  </div>
                ) : (
                  <div key={plan.id} className="flex shrink-0 flex-col gap-2.5">
                    <SupersededPlanNode node={plan} expanded={expanded.has(plan.id)} onToggle={onTogglePlan} />
                    {expanded.has(plan.id) && <SupersededTasks node={plan} />}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 작업 → 승인 → 웹쉘 검증 관문 → 실행 단계 순서로 줄을 맞춘다.
 * 줄 사이 칸과 양쪽 끝 칸을 트랙으로 둬서, 작업이 적으면 칸을 다 쓰면서 작업은 가운데에 모이고 관문은 그 폭을 따른다.
 */
function TaskGrid({
  plan,
  actions,
  gate,
  gateLit,
  gateClosed,
}: {
  plan: ProgressPlanNode
  actions: NodeActions
  gate: GateView | null
  gateLit: number | null
  gateClosed: boolean
}) {
  const tasks = plan.children.filter((child): child is ProgressTaskNode => child.type === 'TASK')
  const tasksWidth = tasks.length * 16 + (tasks.length - 1) * 5.5
  return (
    <div
      className="grid w-full gap-y-4"
      style={{
        gridTemplateColumns: `1fr ${tasks.map(() => '16rem').join(' 5.5rem ')} 1fr`,
        maxWidth: `${Math.max(52, tasksWidth)}rem`,
      }}
    >
      {tasks.map((task, index) => (
        <TaskColumn
          key={task.id}
          node={task}
          actions={actions}
          column={index * 2 + 2}
          cutBelow={gateClosed && task.status !== 'BLOCKED'}
          after={task.dependsOn
            .map((id) => findProgressNode(plan, id))
            .map((node) => (node && 'label' in node ? node.label : ''))
            .join(', ')}
        />
      ))}
      {gate && (
        <div style={{ gridColumn: '1 / -1', gridRow: 3 }} className="my-2">
          <WebshellGate gate={gate} lit={gateLit} />
        </div>
      )}
    </div>
  )
}

// ── 노드 상세 (도식 바로 아래) ─────────────────────────────

function TaskDetail({ requestId, node }: { requestId: string; node: ProgressTaskNode }) {
  const request = useRequest(requestId)
  const task = request.data?.plan?.tasks.find((candidate) => `task:${candidate.id}` === node.id)
  if (request.isPending) return <Spinner label="작업 내용을 불러오는 중" />
  if (!task) return <p className="text-sm text-ink-3">작업 내용을 찾을 수 없습니다.</p>
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-3">
        {TASK_TYPE_LABEL[task.type]} 대상 <Mono>{task.target}</Mono>
      </p>
      {task.forbiddenReason && <p className="text-sm font-medium text-ink">금지 사유: {task.forbiddenReason}</p>}
      <TaskContentView task={task} requestId={requestId} />
    </div>
  )
}

/** 지금 보는 사람이 승인할 수 있는 작업이면 승인 화면으로 보낸다. 판단은 서버의 승인 자료를 따른다. */
function ApproveLink({ requestId, taskId }: { requestId: string; taskId: string }) {
  const onApprovalScreen = useMatch('/approvals/:requestId')
  const context = useQuery({
    queryKey: ['progress-approvable', requestId],
    queryFn: () => approvalsApi.context(requestId),
    enabled: !onApprovalScreen,
  })
  if (onApprovalScreen || !context.data?.approvableTaskIds.includes(taskId)) return null
  return (
    <Link to={`/approvals/${requestId}`} className="inline-flex items-center gap-1 self-start font-medium text-seal hover:underline">
      승인 화면으로 이동
      <ArrowRight size={15} aria-hidden />
    </Link>
  )
}

function ApprovalDetail({ requestId, root, node }: { requestId: string; root: ProgressRequestNode; node: ProgressApprovalNode }) {
  const verb = node.status === 'REJECTED' ? '거부' : '승인'
  if (node.status === 'PENDING') {
    const task = root.children
      .flatMap((plan) => ('children' in plan ? plan.children : []))
      .find((candidate) => 'children' in candidate && candidate.children.some((child) => child.id === node.id))
    return (
      <div className="flex flex-col gap-3">
        <KeyValues
          items={[
            { label: '상태', value: '승인 대기' },
            ...(node.rule ? [{ label: '필요한 승인', value: RULE_LABEL[node.rule] }] : []),
            ...(candidateNames(node).length > 0 ? [{ label: '승인 후보', value: candidatesText(node) }] : []),
          ]}
        />
        {task && <ApproveLink requestId={requestId} taskId={task.id.replace(/^task:/, '')} />}
      </div>
    )
  }
  return (
    <KeyValues
      items={[
        ...(node.label ? [{ label: `${verb}한 사람`, value: node.label }] : []),
        ...(node.at ? [{ label: `${verb} 시각`, value: formatDateTime(node.at) }] : []),
        ...(node.network ? [{ label: '접속 환경', value: <NetworkBadge network={node.network} /> }] : []),
      ]}
    />
  )
}

function nodeTitle(node: ProgressNode): string {
  if (node.type === 'APPROVAL') {
    if (node.status === 'PENDING') return '승인 대기'
    return node.label ? `${APPROVAL_WORD[node.status]}: ${node.label}` : APPROVAL_WORD[node.status]
  }
  if (node.type === 'STEP') return `실행 단계: ${node.label}`
  return node.label
}

function NodeDetail({
  requestId,
  root,
  node,
  panelId,
  onClose,
}: {
  requestId: string
  root: ProgressRequestNode
  node: ProgressNode
  panelId: string
  onClose: () => void
}) {
  const panelRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    panelRef.current?.scrollIntoView({ block: 'nearest' })
  }, [node.id])
  return (
    <section ref={panelRef} id={panelId} aria-label="노드 상세" className="flex flex-col gap-3 rounded-xl border border-rule bg-sheet p-5">
      <header className="flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold break-all">{nodeTitle(node)}</h3>
        <button type="button" aria-label="상세 닫기" onClick={onClose} className="shrink-0 rounded p-1 text-ink-3 hover:bg-sheet-alt hover:text-ink">
          <X size={18} aria-hidden />
        </button>
      </header>
      {node.type === 'TASK' && <TaskDetail requestId={requestId} node={node} />}
      {node.type === 'APPROVAL' && <ApprovalDetail requestId={requestId} root={root} node={node} />}
      {node.type === 'STEP' && (
        <LogViewer key={node.id} requestId={requestId} live={node.status === 'RUNNING'} range={node.logRange} />
      )}
    </section>
  )
}

/** 지금 어디까지 왔고 누구를 기다리는지 한 문장. 경과 시간은 매분 바뀌므로 읽어 주는 영역 밖에 둔다. */
function NowLine({ now, large }: { now: ProgressNow; large?: boolean }) {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = now.since ? formatElapsed(now.since, tick) : null
  return (
    <p
      data-progress-now
      className={`min-w-0 leading-snug font-bold tracking-tight ${large ? 'text-[2.25rem]' : 'text-[1.375rem]'} ${now.mode === 'failed' ? 'text-high' : 'text-ink'}`}
    >
      <span aria-live="polite">{now.text}</span>
      {elapsed && <span className="font-semibold text-ink-2"> · {elapsed === '방금' ? elapsed : `${elapsed}째`}</span>}
    </p>
  )
}

const LARGE_ZOOM = 1.3

export function ProgressTree({ requestId }: { requestId: string }) {
  const { query, retry } = useProgressTree(requestId)
  const request = useRequest(requestId)
  const client = useQueryClient()
  const panelId = useId()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [large, setLarge] = useState(false)
  const largeButton = useRef<HTMLButtonElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const onSelect = useCallback((id: string) => setSelectedId((current) => (current === id ? null : id)), [])
  const onTogglePlan = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  // 트리는 스트림으로 먼저 바뀐다. 관문이 쓰는 요청 상태와 실패 항목도 바로 맞춘다.
  const treeStatus = query.data?.root.status
  const requestStatus = request.data?.status
  useEffect(() => {
    if (treeStatus && requestStatus && treeStatus !== requestStatus) {
      void client.invalidateQueries({ queryKey: ['request', requestId] })
    }
  }, [client, requestId, treeStatus, requestStatus])

  const gate = request.data ? gateView(request.data) : null
  const gateLit = useGateReplay(gate, request.isFetching)

  useEffect(() => {
    const element = dialog.current
    if (large && element && !element.open) element.showModal()
  }, [large])

  const closeLarge = () => {
    setLarge(false)
    largeButton.current?.focus()
  }

  if (query.isPending) return <Spinner label="진행 상황을 불러오는 중" />
  if (query.isError) return <ErrorState error={query.error} onRetry={retry} />

  const { root } = query.data
  const selected = selectedId ? findProgressNode(root, selectedId) : null
  const now = progressNow(root, request.data, gateLit !== null)
  const path = { ids: pathIds(root, now.leaves), mode: now.mode }
  const actions: NodeActions = {
    selectedId,
    onSelect,
    panelId,
    isQuiet: (id) => now.mode !== null && !path.ids.has(id),
    isOnPath: (id) => now.mode !== null && path.ids.has(id),
  }
  const closeDetail = () => {
    // 상세를 닫으면 그 상세를 연 노드로 포커스를 돌려준다.
    container.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(selectedId ?? '')}"]`)?.focus()
    setSelectedId(null)
  }
  const body = (zoom: number) => (
    <>
      <Diagram root={root} actions={actions} expanded={expanded} onTogglePlan={onTogglePlan} gate={gate} gateLit={gateLit} path={path} zoom={zoom} />
      {selected && <NodeDetail requestId={requestId} root={root} node={selected} panelId={panelId} onClose={closeDetail} />}
    </>
  )
  return (
    <div ref={container} className="flow-tree flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        {!large && <NowLine now={now} />}
        <button
          ref={largeButton}
          type="button"
          onClick={() => setLarge(true)}
          className="ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-rule-strong bg-sheet px-3 text-[0.875rem] font-medium whitespace-nowrap text-ink hover:bg-sheet-alt"
        >
          <Maximize2 size={15} aria-hidden />
          크게 보기
        </button>
      </div>
      {!large && body(1)}
      {large && (
        <dialog
          ref={dialog}
          aria-label="진행 상황 크게 보기"
          onClose={closeLarge}
          className="m-0 h-dvh max-h-none w-dvw max-w-none overflow-y-auto bg-paper p-0 text-ink"
        >
          <div className="flex min-h-full flex-col gap-5 px-10 py-7">
            <div className="flex items-start justify-between gap-6">
              <NowLine now={now} large />
              <Button variant="secondary" onClick={() => dialog.current?.close()}>
                <X size={18} aria-hidden className="mr-1" />
                닫기
              </Button>
            </div>
            <div className="flex flex-col gap-3" style={{ zoom: LARGE_ZOOM }}>
              {body(LARGE_ZOOM)}
            </div>
          </div>
        </dialog>
      )}
    </div>
  )
}

/** 진행 상황 접기. 접혀 있는 동안에는 트리를 받지 않고 스트림도 열지 않는다. */
export function ProgressSection({ requestId, defaultOpen }: { requestId: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group min-w-0">
      <summary className="mb-3 inline-flex cursor-pointer list-none items-center gap-1.5 rounded [&::-webkit-details-marker]:hidden">
        <h2 className="text-base font-semibold">진행 상황</h2>
        <ChevronDown size={16} aria-hidden className="text-ink-3 transition-transform group-open:rotate-180" />
      </summary>
      {open && <ProgressTree requestId={requestId} />}
    </details>
  )
}
