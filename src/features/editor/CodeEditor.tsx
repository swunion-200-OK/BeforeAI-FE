import Editor from '@monaco-editor/react'
import './monacoSetup'
import { Spinner } from '../../components/ui'

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  sh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
}

function languageOf(path: string): string {
  return LANGUAGE_BY_EXTENSION[path.split('.').pop() ?? ''] ?? 'plaintext'
}

/** Monaco가 무거워 EditorPage에서 React.lazy로 따로 불러온다. */
export default function CodeEditor({
  path,
  value,
  onChange,
}: {
  path: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Editor
      height="100%"
      path={path}
      language={languageOf(path)}
      value={value}
      onChange={(next) => onChange(next ?? '')}
      loading={<Spinner label="에디터를 여는 중" />}
      options={{
        minimap: { enabled: false },
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        fontSize: 15,
        lineHeight: 24,
        padding: { top: 10, bottom: 10 },
        renderLineHighlight: 'all',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
      }}
    />
  )
}
