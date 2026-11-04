import { useQuery } from '@tanstack/react-query'
import { ChevronRight, FileCode2, Folder, FolderOpen, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '../../api/errors'
import { editorApi } from '../../api/endpoints'
import type { FileEntry } from '../../api/types'

interface TreeProps {
  projectId: string
  commit: string
  activePath: string | null
  modifiedPaths: Set<string>
  onOpenFile: (path: string) => void
}

const indent = (depth: number) => ({ paddingLeft: `${depth * 14 + 8}px` })

function DirectoryEntries({ path, depth, ...tree }: TreeProps & { path: string; depth: number }) {
  const listing = useQuery({
    queryKey: ['editor-files', tree.projectId, path],
    queryFn: () => editorApi.files(tree.projectId, { path, ref: tree.commit }),
  })
  if (listing.isPending) {
    return (
      <p className="flex items-center gap-1.5 py-1 text-xs text-ink-3" style={indent(depth)}>
        <Loader2 size={12} className="animate-spin" aria-hidden />
        불러오는 중
      </p>
    )
  }
  if (listing.isError) {
    return (
      <p className="py-1 text-xs text-high" style={indent(depth)}>
        {errorMessage(listing.error)}
      </p>
    )
  }
  return (
    <ul>
      {listing.data.entries.map((entry) => (
        <TreeEntry key={entry.path} entry={entry} depth={depth} {...tree} />
      ))}
    </ul>
  )
}

function TreeEntry({ entry, depth, ...tree }: TreeProps & { entry: FileEntry; depth: number }) {
  const [open, setOpen] = useState(false)
  const rowClass = 'flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[0.8125rem] hover:bg-paper'

  if (entry.type === 'dir') {
    const Icon = open ? FolderOpen : Folder
    return (
      <li>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={`${rowClass} text-ink-2`}
          style={indent(depth)}
        >
          <ChevronRight size={13} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
          <Icon size={14} className="shrink-0 text-ink-3" aria-hidden />
          <span className="truncate">{entry.name}</span>
        </button>
        {/* 펼칠 때 처음으로 하위 목록을 읽는다 */}
        {open && <DirectoryEntries path={entry.path} depth={depth + 1} {...tree} />}
      </li>
    )
  }

  const active = tree.activePath === entry.path
  const modified = tree.modifiedPaths.has(entry.path)
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={() => tree.onOpenFile(entry.path)}
        className={`${rowClass} ${active ? 'bg-seal-soft font-medium text-seal-dark' : 'text-ink'}`}
        style={indent(depth)}
      >
        <span className="w-[13px] shrink-0" aria-hidden />
        <FileCode2 size={14} className="shrink-0 text-ink-3" aria-hidden />
        <span className="flex-1 truncate">{entry.name}</span>
        {modified && <span className="shrink-0 text-xs font-medium text-medium">수정됨</span>}
      </button>
    </li>
  )
}

export function FileTree(props: TreeProps) {
  return (
    <div className="py-1">
      <DirectoryEntries path="" depth={0} {...props} />
    </div>
  )
}
