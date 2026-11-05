/** AI 질문을 읽기 좋게 나눈다. 줄바꿈이 있으면 줄로, 없으면 "1." "2)" 같은 번호 앞에서 나눈다. */
export function clarificationLines(text: string): string[] {
  const byLine = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const lines = byLine.length > 1 ? byLine : text.split(/\s+(?=\(?\d{1,2}[.)]\s)/).map((line) => line.trim()).filter(Boolean)
  return lines.map((line) => line.replace(/^[-*•]\s*/, ''))
}
