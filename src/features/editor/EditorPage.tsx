import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitCommitHorizontal, X } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ApiError, errorMessage } from '../../api/errors'
import { editorApi } from '../../api/endpoints'
import { DiffViewer } from '../../components/DiffViewer'
import { toast } from '../../components/toast'
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Mono,
  PageHeader,
  Select,
  Sheet,
  Spinner,
  Tabs,
  TextInput,
} from '../../components/ui'
import { makeUnifiedDiff } from '../../lib/diff'
import { useProjects, useRefreshAll } from '../../lib/queries'
import { FileTree } from './FileTree'

const CodeEditor = lazy(() => import('./CodeEditor'))

type View = 'edit' | 'diff'

/** 프로젝트 하나를 연 작업 공간. 새로고침하면 key가 바뀌어 처음부터 다시 연다. */
function Workspace({ projectId, onReload }: { projectId: string; onReload: () => void }) {
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
  const [opening, setOpening] = useState(false)
  const [view, setView] = useState<View>('edit')
  const [description, setDescription] = useState('')
  const [conflict, setConflict] = useState(false)

  const changedPaths = useMemo(
    () => Object.keys(drafts).filter((path) => drafts[path] !== originals[path]),
    [drafts, originals],
  )
  const modifiedSet = useMemo(() => new Set(changedPaths), [changedPaths])
  const patches = useMemo(
    () => changedPaths.map((path) => ({ path, patch: makeUnifiedDiff(path, originals[path], drafts[path]) })),
    [changedPaths, originals, drafts],
  )

  const openFile = async (path: string) => {
    setView('edit')
    if (originals[path] !== undefined) {
      setOpenPaths((paths) => (paths.includes(path) ? paths : [...paths, path]))
      setActivePath(path)
      return
    }
    setOpening(true)
    try {
      const file = await editorApi.content(projectId, { path, ref: baseCommit ?? undefined })
      setOriginals((current) => ({ ...current, [path]: file.content }))
      setDrafts((current) => ({ ...current, [path]: file.content }))
      setOpenPaths((paths) => [...paths, path])
      setActivePath(path)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setOpening(false)
    }
  }

  const closeFile = (path: string) => {
    const remaining = openPaths.filter((p) => p !== path)
    setOpenPaths(remaining)
    if (activePath === path) setActivePath(remaining[remaining.length - 1] ?? null)
  }

  const save = useMutation({
    mutationFn: () =>
      editorApi.save(projectId, {
        baseCommit: baseCommit as string,
        description: description.trim(),
        files: patches,
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

  if (root.isPending) return <Spinner label="저장소를 여는 중" />
  if (root.isError) return <ErrorState error={root.error} onRetry={() => root.refetch()} />

  const saveBlockedReason = conflict
    ? '저장소가 바뀌어 저장할 수 없습니다. 새로고침해 주세요'
    : changedPaths.length === 0
      ? '바뀐 파일이 없습니다'
      : !description.trim()
        ? '변경 설명을 입력해 주세요'
        : null

  return (
    <div className="flex flex-col gap-4">
      {conflict && (
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
      )}

      <div className="flex items-center gap-1.5 text-[0.8125rem] text-ink-2">
        <GitCommitHorizontal size={15} className="text-ink-3" aria-hidden />
        기준 커밋 <Mono>{baseCommit}</Mono>
      </div>

      <div className="grid grid-cols-[15rem_minmax(0,1fr)] gap-4 max-md:grid-cols-1">
        <Sheet title="파일" flush className="max-md:max-h-56 max-md:overflow-y-auto">
          <FileTree
            projectId={projectId}
            commit={baseCommit as string}
            activePath={activePath}
            modifiedPaths={modifiedSet}
            onOpenFile={openFile}
          />
        </Sheet>

        <div className="min-w-0">
          <Tabs<View>
            value={view}
            onChange={setView}
            tabs={[
              { id: 'edit', label: '편집' },
              { id: 'diff', label: `변경 미리보기 (${changedPaths.length})` },
            ]}
          />

          {view === 'edit' ? (
            <div className="overflow-hidden rounded-md border border-rule bg-sheet">
              {openPaths.length > 0 && (
                <div className="flex flex-wrap border-b border-rule bg-sheet-alt" role="tablist" aria-label="연 파일">
                  {openPaths.map((path) => (
                    <div
                      key={path}
                      className={`flex items-center border-r border-rule text-xs ${
                        path === activePath ? 'bg-sheet font-medium text-ink' : 'text-ink-2'
                      }`}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={path === activePath}
                        onClick={() => setActivePath(path)}
                        className="py-1.5 pr-1 pl-2.5 font-mono"
                      >
                        {path.split('/').pop()}
                        {modifiedSet.has(path) && <span className="ml-1 font-sans text-medium">수정됨</span>}
                      </button>
                      <button
                        type="button"
                        onClick={() => closeFile(path)}
                        aria-label={`${path} 닫기`}
                        className="p-1 pr-1.5 text-ink-3 hover:text-ink"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="h-[30rem]">
                {activePath ? (
                  <Suspense fallback={<Spinner label="에디터를 여는 중" />}>
                    <CodeEditor
                      path={activePath}
                      value={drafts[activePath] ?? ''}
                      onChange={(next) => setDrafts((current) => ({ ...current, [activePath]: next }))}
                    />
                  </Suspense>
                ) : opening ? (
                  <Spinner label="파일을 여는 중" />
                ) : (
                  <EmptyState title="왼쪽에서 수정할 파일을 고르세요">
                    급한 코드 수정 전용 에디터입니다. 여러 파일을 고쳐도 작업 1개짜리 Plan이 됩니다.
                  </EmptyState>
                )}
              </div>
            </div>
          ) : patches.length === 0 ? (
            <Sheet>
              <EmptyState title="아직 바뀐 파일이 없습니다">파일을 고치면 여기에서 좌우로 비교할 수 있습니다.</EmptyState>
            </Sheet>
          ) : (
            <div className="flex flex-col gap-3">
              {patches.map(({ path, patch }) => (
                <DiffViewer key={path} diff={patch} />
              ))}
            </div>
          )}
        </div>
      </div>

      <Sheet>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
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
          </div>
          <Button
            variant="primary"
            disabled={Boolean(saveBlockedReason)}
            disabledReason={saveBlockedReason}
            loading={save.isPending}
            onClick={() => save.mutate()}
            className="mb-5"
          >
            저장하고 요청 만들기
          </Button>
        </div>
      </Sheet>
    </div>
  )
}

export default function EditorPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const projects = useProjects()
  const [session, setSession] = useState(0)

  return (
    <>
      <PageHeader
        title="웹 코드 에디터"
        description="급한 코드 수정 전용입니다."
        actions={
          <div className="w-56">
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
          </div>
        }
      />
      <div className="mb-4">
        <Banner tone="info">저장한 변경도 승인·서명 절차를 거칩니다. 저장소에 바로 반영되지 않습니다.</Banner>
      </div>
      {projectId ? (
        <Workspace key={`${projectId}:${session}`} projectId={projectId} onReload={() => setSession((n) => n + 1)} />
      ) : (
        <Sheet>
          <EmptyState title="수정할 프로젝트를 고르세요">오른쪽 위에서 프로젝트를 고르면 파일 목록이 열립니다.</EmptyState>
        </Sheet>
      )}
    </>
  )
}
