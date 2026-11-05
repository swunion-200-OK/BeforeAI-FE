/** JPEG 한 장을 A4 한 쪽에 꽉 채운 최소한의 PDF로 감싼다. 브라우저 API를 쓰지 않는 순수 함수다. */

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
/** 파일에 바이너리가 있다고 알리는 머리 주석 (PDF 32000-1 7.5.2) */
const BINARY_MARKER = Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a)

export interface ImagePdfInput {
  jpeg: Uint8Array
  /** JPEG의 픽셀 크기 */
  width: number
  height: number
  /** PDF 보기 창에 나오는 문서 제목 */
  title: string
}

function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0))
}

/** 한글 제목을 쓰려고 UTF-16BE 16진 문자열로 적는다. */
function utf16Hex(text: string): string {
  const units = Array.from({ length: text.length }, (_, index) => text.charCodeAt(index).toString(16).padStart(4, '0'))
  return `<FEFF${units.join('').toUpperCase()}>`
}

export function buildImagePdf({ jpeg, width, height, title }: ImagePdfInput): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = []
  let length = 0
  const write = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? asciiBytes(data) : data
    parts.push(bytes)
    length += bytes.length
  }

  const offsets: number[] = []
  const object = (number: number, body: string | Array<string | Uint8Array>) => {
    offsets[number] = length
    write(`${number} 0 obj\n`)
    for (const part of typeof body === 'string' ? [body] : body) write(part)
    write('\nendobj\n')
  }

  write('%PDF-1.4\n')
  write(BINARY_MARKER)

  const drawImage = `q ${A4_WIDTH} 0 0 ${A4_HEIGHT} 0 0 cm /Im0 Do Q`
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  )
  object(4, [
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream',
  ])
  object(5, `<< /Length ${drawImage.length} >>\nstream\n${drawImage}\nendstream`)
  object(6, `<< /Title ${utf16Hex(title)} /Creator (BeforeAI) >>`)

  const xrefOffset = length
  const entries = offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${entries.join('')}`)
  write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  const pdf = new Uint8Array(length)
  let position = 0
  for (const part of parts) {
    pdf.set(part, position)
    position += part.length
  }
  return pdf
}
