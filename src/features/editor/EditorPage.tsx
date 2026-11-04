import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Code2, FileDiff, FolderTree, GitCommitHorizontal, PencilLine, ShieldCheck, Sparkles, X } from 'lucide-react'
import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ApiError, errorMessage } from '../../api/errors'
import { editorApi } from '../../api/endpoints'
import { DiffViewer } from '../../components/DiffViewer'
import { ProjectTag, SegmentedTabs, Timeline } from '../../components/rich'
import { toast } from '../../components/toast'
import { Banner, Button, EmptyState, ErrorState, Field, Mono, Select, Spinner, TextInput } from '../../components/ui'
import { makeUnifiedDiff } from '../../lib/diff'
import { diffStats } from '../../lib/explain'
import { useDepartmentNames, useProjects, useRefreshAll } from '../../lib/queries'
import { FileTree } from './FileTree'

const CodeEditor = lazy(() => import('./CodeEditor'))

type View = 'edit' | 'diff'

/** 화면 맨 위 도구줄. 프로젝트, 기준 커밋, 바뀐 파일 수가 항상 보인다. */
function Toolbar({
  projectSelect,
  baseCommit,
  changedCount,
}: {
  projectSelect: ReactNode
  baseCommit?: string | null
  changedCount?: number
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-4 border-b border-rule bg-sheet px-4">
      <h1 className="flex shrink-0 items-center gap-2 text-[0.9375rem] font-bold">
        <Code2 size={17} className="text-seal" aria-hidden />
        웹 코드 에디터
      </h1>
      <div className="w-48 shrink-0">{projectSelect}</div>
      {baseCommit && (
        <span className="flex shrink-0 items-center gap-1.5 text-[0.8125rem] text-ink-2">
          <GitCommitHorizontal size={15} className="text-ink-3" aria-hidden />
          기준 커밋 <Mono>{baseCommit}</Mono>
        </span>
      )}
      <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[0.8125rem] text-ink-2">
        <ShieldCheck size={15} className="shrink-0 text-seal" aria-hidden />
        <span className="truncate">저장한 변경도 승인·서명 절차를 거칩니다. 저장소에 바로 반영되지 않습니다.</span>
      </p>
      {changedCount !== undefined && (
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-[0.8125rem] font-medium tabular-nums ${
            changedCount > 0 ? 'bg-medium-soft text-medium' : 'bg-paper text-ink-3'
          }`}
        >
          변경 파일 {changedCount}개
        </span>
      )}
    </div>
  )
}

function fileName(path: string) {
  return path.split('/').pop() ?? path
}

/** 프로젝트 하나를 연 작업 공간. 새로고침하면 key가 바뀌어 처음부터 다시 연다. */
function Workspace({
  projectId,
  projectSelect,
  onReload,
}: {
  projectId: string
  projectSelect: ReactNode
  onReload: () => void
}) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const refreshAll = useRefreshAll()

  // 기준 커밋은 에디터를 연 시점의 값으로 고정한다. 그래야 저장 때 충돌을 알아챈다.
  const root = useQuery({
    queryKey: ['editor-root', projectId],
    queryFn: () => editorApi.files(projectId),
    staleTime: Infinity,
    gcTime: 0,
  })
  // 전역 새로고침으로 목록을 다시 읽어도 처음 받은 값을 유지한다.
  const [baseCommit, setBaseCommit] = useState<string | null>(null)
  if (root.data && baseCommit === null) setBaseCommit(root.data.baseCommit)

  const [originals, setOriginals] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [openPaths, setOpenPaths] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [loadingCount, setLoadingCount] = useState(0)
  const [view, setView] = useState<View>('edit')
  const [description, setDescription] = useState('')
  const [conflict, setConflict] = useState(false)

  // 빠르게 두 번 눌러도 한 번만 읽고, 마지막으로 누른 파일만 앞으로 가져온다.
  const inFlight = useRef(new Set<string>())
  const lastRequested = useRef<string | null>(null)

  const changedPaths = useMemo(
    () => Object.keys(drafts).filter((path) => drafts[path] !== originals[path]),
    [drafts, originals],
  )
  const modifiedSet = useMemo(() => new Set(changedPaths), [changedPaths])
  const patches = useMemo(
    () =>
      changedPaths.map((path) => {
        const patch = makeUnifiedDiff(path, originals[path], drafts[path])
        return { path, patch, stats: diffStats(patch) }
      }),
    [changedPaths, originals, drafts],
  )
  const totals = useMemo(
    () =>
      patches.reduce(
        (sum, { stats }) => ({ added: sum.added + stats.added, removed: sum.removed + stats.removed }),
        { added: 0, removed: 0 },
      ),
    [patches],
  )

  const addTab = (path: string) => setOpenPaths((paths) => (paths.includes(path) ? paths : [...paths, path]))

  const openFile = async (path: string) => {
    setView('edit')
    lastRequested.current = path
    if (originals[path] !== undefined) {
      addTab(path)
      setActivePath(path)
      return
    }
    if (inFlight.current.has(path)) return
    inFlight.current.add(path)
    setLoadingCount((count) => count + 1)
    try {
      const file = await editorApi.content(projectId, { path, ref: baseCommit ?? undefined })
      // 그사이 고친 내용을 늦게 온 응답이 덮어쓰지 않게 비어 있을 때만 채운다.
      setOriginals((current) => (current[path] === undefined ? { ...current, [path]: file.content } : current))
      setDrafts((current) => (current[path] === undefined ? { ...current, [path]: file.content } : current))
      addTab(path)
      if (lastRequested.current === path) setActivePath(path)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      inFlight.current.delete(path)
      setLoadingCount((count) => count - 1)
    }
  }

  const closeFile = (path: string) => {
    const remaining = openPaths.filter((p) => p !== path)
    setOpenPaths(remaining)
    if (activePath === path) {
      const next = remaining[remaining.length - 1] ?? null
      lastRequested.current = next
      setActivePath(next)
    }
  }

  const selectTab = (path: string) => {
    lastRequested.current = path
    setActivePath(path)
  }

  const save = useMutation({
    mutationFn: () =>
      editorApi.save(projectId, {
        baseCommit: baseCommit as string,
        description: description.trim(),
        files: patches.map(({ path, patch }) => ({ path, patch })),
      }),
    meta: { silent: true },
    onSuccess: async ({ requestId }) => {
      await refreshAll()
      toast.success('변경을 저장해 새 요청을 만들었습니다. 제출하면 승인 절차가 시작됩니다')
      navigate(`/requests/new/${requestId}`)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'EDIT_CONFLICT') setConflict(true)
      else toast.error(errorMessage(error))
    },
  })

  const reload = () => {
    client.removeQueries({ queryKey: ['editor-files', projectId] })
    client.removeQueries({ queryKey: ['editor-root', projectId] })
    onReload()
  }

  if (root.isPending || root.isError) {
    return (
      <>
        <Toolbar projectSelect={projectSelect} />
        {root.isPending ? <Spinner label="저장소를 여는 중" /> : <ErrorState error={root.error} onRetry={() => root.refetch()} />}
      </>
    )
  }

  const saveBlockedReason = conflict
    ? '저장소가 바뀌어 저장할 수 없습니다. 새로고침해 주세요'
    : changedPaths.length === 0
      ? '바뀐 파일이 없습니다'
      : !description.trim()
        ? '변경 설명을 입력해 주세요'
        : null

  return (
    <>
      <Toolbar projectSelect={projectSelect} baseCommit={baseCommit} changedCount={changedPaths.length} />

      {conflict && (
        <div className="shrink-0 border-b border-rule bg-sheet p-2.5">
          <Banner
            tone="danger"
            title="저장소가 바뀌었습니다"
            action={
              <Button size="sm" variant="danger-outline" onClick={reload}>
                새로고침
              </Button>
            }
          >
            에디터를 연 뒤 다른 변경이 저장소에 반영되어 저장하지 못했습니다. 새로고침하면 최신 커밋으로 다시 열리고, 지금
            수정한 내용은 사라집니다.
          </Banner>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)_340px]">
        {/* 왼쪽: 파일 트리 */}
        <aside aria-label="파일" className="flex min-h-0 flex-col border-r border-rule bg-sheet">
          <p className="flex h-10 shrink-0 items-center gap-1.5 border-b border-rule px-3 text-[0.8125rem] font-semibold">
            <FolderTree size={15} className="text-ink-3" aria-hidden />
            파일
          </p>
          <div className="quiet-scroll min-h-0 flex-1 overflow-y-auto">
            <FileTree
              projectId={projectId}
              commit={baseCommit as string}
              activePath={activePath}
              modifiedPaths={modifiedSet}
              onOpenFile={openFile}
            />
          </div>
        </aside>

        {/* 가운데: 코드 또는 변경 미리보기 */}
        <section aria-label="코드" className="flex min-h-0 min-w-0 flex-col bg-sheet">
          <div className="flex h-10 shrink-0 items-stretch justify-between border-b border-rule bg-sheet-alt">
            <div className="flex min-w-0 overflow-x-auto" role="tablist" aria-label="연 파일">
              {view === 'edit' &&
                openPaths.map((path) => (
                  <div
                    key={path}
                    className={`flex shrink-0 items-center border-r border-rule text-xs ${
                      path === activePath ? 'bg-sheet font-medium text-ink shadow-[inset_0_2px_0_var(--color-seal)]' : 'text-ink-2'
                    }`}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={path === activePath}
                      title={path}
                      onClick={() => selectTab(path)}
                      className="h-full pr-1 pl-3 font-mono"
                    >
                      {fileName(path)}
                      {modifiedSet.has(path) && <span className="ml-1.5 font-sans text-medium">수정됨</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => closeFile(path)}
                      aria-label={`${path} 닫기`}
                      className="p-1 pr-2 text-ink-3 hover:text-ink"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
            </div>
            <div className="flex shrink-0 items-center px-2">
              <SegmentedTabs<View>
                label="보기"
                value={view}
                onChange={setView}
                items={[
                  { id: 'edit', label: '편집', icon: PencilLine },
                  { id: 'diff', label: '변경 미리보기', icon: FileDiff, count: changedPaths.length },
                ]}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1">
            {view === 'edit' ? (
              activePath ? (
                <Suspense fallback={<Spinner label="에디터를 여는 중" />}>
                  <CodeEditor
                    path={activePath}
                    value={drafts[activePath] ?? ''}
                    onChange={(next) => setDrafts((current) => ({ ...current, [activePath]: next }))}
                  />
                </Suspense>
              ) : loadingCount > 0 ? (
                <Spinner label="파일을 여는 중" />
              ) : (
                <EmptyState title="왼쪽에서 수정할 파일을 고르세요">
                  급한 코드 수정 전용 에디터입니다. 여러 파일을 고쳐도 작업 1개짜리 Plan이 됩니다.
                </EmptyState>
              )
            ) : patches.length === 0 ? (
              <EmptyState title="아직 바뀐 파일이 없습니다">파일을 고치면 여기에서 좌우로 비교할 수 있습니다.</EmptyState>
            ) : (
              <div className="quiet-scroll flex h-full flex-col gap-3 overflow-y-auto bg-paper p-3">
                {patches.map(({ path, patch }) => (
                  <DiffViewer key={path} diff={patch} />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 오른쪽: 변경 요약과 저장 */}
        <aside aria-label="변경 요약" className="flex min-h-0 flex-col border-l border-rule bg-sheet">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-rule px-3">
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
              <FileDiff size={15} className="text-ink-3" aria-hidden />
              변경 요약
            </p>
            {patches.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs tabular-nums">
                <span className="font-medium text-low">+{totals.added}</span>
                <span className="font-medium text-high">−{totals.removed}</span>
              </span>
            )}
          </div>

          <div className="quiet-scroll min-h-0 flex-1 overflow-y-auto">
            {patches.length === 0 ? (
              <p className="px-3 py-4 text-[0.8125rem] text-ink-3">
                아직 바뀐 파일이 없습니다. 파일을 고치면 바뀐 줄 수가 여기에 쌓입니다.
              </p>
            ) : (
              <ul className="divide-y divide-rule">
                {patches.map(({ path, stats }) => (
                  <li key={path}>
                    <button
                      type="button"
                      title={path}
                      onClick={() => openFile(path)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-paper ${
                        path === activePath ? 'bg-seal-soft' : ''
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{path}</span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
                        <span className="font-medium text-low">+{stats.added}</span>
                        <span className="font-medium text-high">−{stats.removed}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="shrink-0 border-t border-rule px-3 py-3">
            <p className="mb-2 text-xs font-semibold text-ink-2">저장하면 이렇게 진행됩니다</p>
            <Timeline
              items={[
                { key: 'request', title: '코드 수정 작업 1개짜리 요청이 만들어집니다', tone: 'todo' },
                {
                  key: 'explain',
                  title: (
                    <span className="inline-flex items-start gap-1">
                      <Sparkles size={13} className="mt-0.5 shrink-0 text-ai" aria-hidden />
                      AI가 위험도를 매기고 어디가 어떻게 바뀌는지 쉬운 말로 설명합니다
                    </span>
                  ),
                  tone: 'todo',
                },
                { key: 'approve', title: '제출하면 승인·서명과 실행기 검증을 거쳐 실행됩니다', tone: 'todo' },
              ]}
            />
          </div>

          <div className="flex shrink-0 flex-col gap-2.5 border-t border-rule bg-sheet-alt p-3">
            <Field label="변경 설명" hint="승인권자가 보는 작업 이름이 됩니다">
              {(id) => (
                <TextInput
                  id={id}
                  value={description}
                  placeholder="예: 로그인 타임아웃 긴급 수정"
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </Field>
            <div className="[&>span]:flex [&>span]:w-full">
              <Button
                variant="primary"
                className="w-full"
                disabled={Boolean(saveBlockedReason)}
                disabledReason={saveBlockedReason}
                loading={save.isPending}
                onClick={() => save.mutate()}
              >
                저장하고 요청 만들기
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}

/** 프로젝트를 고르기 전 화면. 고를 수 있는 저장소를 바로 보여 준다. */
function ProjectPicker() {
  const navigate = useNavigate()
  const projects = useProjects()
  const departmentName = useDepartmentNames()
  return (
    <div className="quiet-scroll min-h-0 flex-1 overflow-y-auto p-6">
      <EmptyState title="수정할 프로젝트를 고르세요">프로젝트를 고르면 파일 목록이 열립니다.</EmptyState>
      {projects.data && (
        <ul className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
          {projects.data.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                onClick={() => navigate(`/editor/${project.id}`)}
                className="flex w-full flex-col gap-1.5 rounded-xl border border-rule bg-sheet p-4 text-left shadow-card transition-colors hover:border-seal/50 hover:bg-seal-soft/30"
              >
                <ProjectTag name={project.name} />
                <span className="text-xs text-ink-3">{departmentName(project.departmentId)}</span>
                <span className="flex items-center gap-1.5 text-xs text-ink-2">
                  <GitCommitHorizontal size={13} className="text-ink-3" aria-hidden />
                  <Mono>{project.baseCommit}</Mono>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function EditorPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const projects = useProjects()
  const [session, setSession] = useState(0)

  const projectSelect = (
    <Select
      aria-label="프로젝트"
      value={projectId ?? ''}
      onChange={(event) => navigate(`/editor/${event.target.value}`)}
    >
      <option value="" disabled>
        프로젝트 고르기
      </option>
      {projects.data?.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </Select>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      {projectId ? (
        <Workspace
          key={`${projectId}:${session}`}
          projectId={projectId}
          projectSelect={projectSelect}
          onReload={() => setSession((n) => n + 1)}
        />
      ) : (
        <>
          <Toolbar projectSelect={projectSelect} />
          <ProjectPicker />
        </>
      )}
    </div>
  )
}
