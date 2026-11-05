import { clarificationLines } from '../lib/clarification'

/** AI 질문. 여러 개면 한 줄씩 띄워서 보여 준다. */
export function ClarificationText({ text }: { text: string }) {
  const lines = clarificationLines(text)
  if (lines.length === 1) return <p className="text-lg leading-relaxed break-keep text-ink">{lines[0]}</p>
  return (
    <ul className="flex flex-col gap-2.5 text-lg leading-relaxed break-keep text-ink">
      {lines.map((line, index) => (
        <li key={index} className={index === 0 && !/^\(?\d/.test(line) ? 'font-medium' : 'border-l-2 border-rule-strong pl-3'}>
          {line}
        </li>
      ))}
    </ul>
  )
}
