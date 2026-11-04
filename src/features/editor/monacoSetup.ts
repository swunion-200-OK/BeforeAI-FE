/**
 * Monaco를 CDN 없이 번들에서 불러온다. 내부망에서는 외부로 요청이 나가면 안 된다.
 * @monaco-editor/react의 기본 동작은 CDN 로드이므로 loader.config로 반드시 바꿔 둔다.
 */
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new JsonWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

// 저장소의 다른 파일을 읽지 못하므로 import 오류가 항상 난다. 문법 오류만 표시한다.
monaco.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true })
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true })

loader.config({ monaco })
