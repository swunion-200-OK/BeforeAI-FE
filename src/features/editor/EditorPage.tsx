import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ApiError, errorMessage } from '../../api/errors'
import { editorApi } from '../../api/endpoints'
import { DiffViewer } from '../../components/DiffViewer'
import { toast } from '../../components/toast'
import { Banner, Button, EmptyState, ErrorState, Field, Modal, Mono, Select, Sheet, Spinner, TextInput } from '../../components/ui'
import { makeUnifiedDiff } from '../../lib/diff'
import { diffStats } from '../../lib/explain'
import { useDepartmentNames, useProjects, useRefreshAll } from '../../lib/queries'
import { FileTree } from './FileTree'

const CodeEditor = lazy(() => import('./CodeEditor'))

/** 화면 맨 위 얇은 도구줄. 프로젝트, 기준 커밋, 저장 버튼만 둔다. */
function Toolbar({
  projectSelect,
  baseCommit,
  children,
}: {
  projectSelect: ReactNode
  baseCommit?: string | null
  children?: ReactNode
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-4 border-b border-rule bg-sheet px-4">
      <h1 className="sr-only">웹 코드 에디터</h1>
      <div className="w-48 shrink-0">{projectSelect}</div>
      {baseCommit && (
        <span className="shrink-0 text-[0.875rem] text-ink-3">
          기준 커밋 <Mono className="text-ink-2">{baseCommit}</Mono>
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-3">{children}</div>
    </div>
  )
}

function LineStats({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[0.875rem] tabular-nums">
      <span className="font-medium text-low">+{added}</span>
      <span className="font-medium text-high">−{removed}</span>
    </span>
  )
}

/** 저장 전 마지막 확인. 무엇이 바뀌는지 보고 설명을 적어 저장한다. */
function SaveModal({
  open,
  patches,
  totals,
  description,
  onDescriptionChange,
  saving,
  onSave,
  onClose,
}: {
  open: boolean
  patches: Array<{ path: string; patch: string; stats: { added: number; removed: number } }>
  totals: { added: number; removed: number }
  description: string
  onDescriptionChange: (value: string) => void
  saving: boolean
  onSave: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      wide
      title="변경 저장"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button
            variant="primary"
            disabled={!description.trim()}
            disabledReason="변경 설명을 입력해 주세요"
            loading={saving}
            onClick={onSave}
          >
            저장하고 요청 만들기
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">저장한 변경도 승인·서명 절차를 거칩니다.</p>
        <Field label="변경 설명" hint="승인권자가 보는 작업 이름이 됩니다">
          {(id) => (
            <TextInput
              id={id}
              value={description}
              placeholder="예: 로그인 타임아웃 긴급 수정"
              onChange={(event) => onDescriptionChange(event.target.value)}
            />
          )}
        </Field>
        <div>
          <p className="mb-1 flex items-center justify-between gap-2 text-[0.875rem] font-medium text-ink-2">
            바뀐 파일 {patches.length}개
            <LineStats {...totals} />
          </p>
          <ul aria-label="바뀐 파일">
            {patches.map(({ path, stats }) => (
              <li key={path} className="flex items-center justify-between gap-3 py-1">
                <span className="min-w-0 truncate font-mono text-[0.875rem] text-ink" title={path}>
                  {path}
                </span>
                <LineStats {...stats} />
              </li>
            ))}
          </ul>
        </div>
        {patches.map(({ path, patch }) => (
          <DiffViewer key={path} diff={patch} />
        ))}
      </div>
    </Modal>
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
  const [reviewing, setReviewing] = useState(false)
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
      // 화면을 옮기기 전에 창을 먼저 닫는다. 그래야 토스트가 닫힌 창 안에 갇히지 않는다.
      setReviewing(false)
      await refreshAll()
      toast.success('변경을 저장해 새 요청을 만들었습니다. 제출하면 승인 절차가 시작됩니다')
      navigate(`/requests/new/${requestId}`)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'EDIT_CONFLICT') {
        setReviewing(false)
        setConflict(true)
      } else toast.error(errorMessage(error))
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
      : null

  return (
    <>
      <Toolbar projectSelect={projectSelect} baseCommit={baseCommit}>
        <span className="text-[0.875rem] text-ink-3 tabular-nums">
          {changedPaths.length > 0 ? `바뀐 파일 ${changedPaths.length}개` : '바뀐 파일 없음'}
        </span>
        <Button
          variant="primary"
          disabled={Boolean(saveBlockedReason)}
          disabledReason={saveBlockedReason}
          onClick={() => setReviewing(true)}
        >
          저장
        </Button>
      </Toolbar>

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
            새로고침하면 최신 커밋으로 다시 열리고, 지금 수정한 내용은 사라집니다.
          </Banner>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[15.5rem_minmax(0,1fr)] bg-sheet">
        <aside aria-label="파일" className="quiet-scroll min-h-0 overflow-y-auto border-r border-rule">
          <FileTree
            projectId={projectId}
            commit={baseCommit as string}
            activePath={activePath}
            modifiedPaths={modifiedSet}
            onOpenFile={openFile}
          />
        </aside>

        <section aria-label="코드" className="flex min-h-0 min-w-0 flex-col">
          {openPaths.length > 0 && (
            <div className="flex h-10 shrink-0 overflow-x-auto border-b border-rule" role="tablist" aria-label="연 파일">
              {openPaths.map((path) => (
                <div
                  key={path}
                  className={`flex shrink-0 items-center text-[0.875rem] ${
                    path === activePath ? 'font-medium text-ink shadow-[inset_0_-2px_0_var(--color-seal)]' : 'text-ink-3'
                  }`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={path === activePath}
                    title={path}
                    onClick={() => selectTab(path)}
                    className="flex h-full items-center pr-1 pl-3 font-mono"
                  >
                    {fileName(path)}
                    {modifiedSet.has(path) && (
                      <>
                        <span aria-hidden className="ml-1.5 size-1.5 rounded-full bg-medium" />
                        <span className="sr-only">수정됨</span>
                      </>
                    )}
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
          )}

          <div className="min-h-0 flex-1">
            {activePath ? (
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
              <div className="flex h-full items-center justify-center pb-24 text-[1.125rem]">
                <EmptyState title="왼쪽에서 수정할 파일을 고르세요">여러 파일을 고쳐도 작업 하나로 묶여 승인받습니다.</EmptyState>
              </div>
            )}
          </div>
        </section>
      </div>

      <SaveModal
        open={reviewing}
        patches={patches}
        totals={totals}
        description={description}
        onDescriptionChange={setDescription}
        saving={save.isPending}
        onSave={() => save.mutate()}
        onClose={() => setReviewing(false)}
      />
    </>
  )
}

/** 프로젝트를 고르기 전 화면. 고를 수 있는 프로젝트 목록만 보여 준다. */
function ProjectPicker() {
  const navigate = useNavigate()
  const projects = useProjects()
  const departmentName = useDepartmentNames()
  return (
    <div className="quiet-scroll min-h-0 flex-1 overflow-y-auto px-8 py-10">
      <div className="mx-auto max-w-xl">
        <h1 className="mb-4 text-[1.5rem] font-bold tracking-tight">수정할 프로젝트를 고르세요</h1>
        {projects.isError ? (
          <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
        ) : projects.isPending ? (
          <Spinner />
        ) : (
          <Sheet flush>
            <ul className="divide-y divide-rule">
              {projects.data.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/editor/${project.id}`)}
                    className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-sheet-alt"
                  >
                    <span className="text-sm font-medium">{project.name}</span>
                    <span className="text-[0.875rem] text-ink-3">{departmentName(project.departmentId)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Sheet>
        )}
      </div>
    </div>
  )
}

export default function EditorPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const projects = useProjects()
  const [session, setSession] = useState(0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      {projectId ? (
        <Workspace
          key={`${projectId}:${session}`}
          projectId={projectId}
          projectSelect={
            <Select
              aria-label="프로젝트"
              value={projectId}
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
          }
          onReload={() => setSession((n) => n + 1)}
        />
      ) : (
        <ProjectPicker />
      )}
    </div>
  )
}
