// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildImagePdf } from './imagePdf'

const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x7f, 0xfe, 0xff, 0xd9)
const pdf = buildImagePdf({ jpeg: JPEG, width: 1240, height: 1754, title: '승인 기록 문서' })
/** 한 바이트를 한 글자로 읽어 바이트 위치와 문자열 위치를 맞춘다. */
const text = new TextDecoder('latin1').decode(pdf)

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((byte, index) => haystack[start + index] === byte)) return start
  }
  return -1
}

describe('buildImagePdf', () => {
  it('%PDF- 머리로 시작하고 %%EOF로 끝난다', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('이미지 바이트를 그대로 담고 길이와 크기를 적는다', () => {
    expect(indexOfBytes(pdf, JPEG)).toBeGreaterThan(0)
    expect(text).toContain(`/Filter /DCTDecode /Length ${JPEG.length}`)
    expect(text).toContain('/Width 1240 /Height 1754')
  })

  it('A4 한 쪽이다', () => {
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]')
    expect(text).toContain('/Count 1')
  })

  it('xref의 위치가 실제 객체를 가리킨다', () => {
    const start = Number(/startxref\n(\d+)\n/.exec(text)?.[1])
    expect(text.slice(start, start + 5)).toBe('xref\n')
    const lines = text.slice(start).split('\n')
    expect(lines[1]).toBe('0 7')
    expect(lines[2]).toBe('0000000000 65535 f ')
    for (let number = 1; number <= 6; number += 1) {
      const entry = lines[2 + number]
      expect(entry).toHaveLength(19)
      expect(text.slice(Number(entry.slice(0, 10))).startsWith(`${number} 0 obj\n`)).toBe(true)
    }
  })

  it('한글 제목은 UTF-16BE 16진 문자열로 적는다', () => {
    expect(text).toContain('/Title <FEFFC2B9C778')
  })
})
