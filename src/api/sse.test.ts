// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createSseParser, type SseMessage } from './sse'

function parse(...chunks: string[]) {
  const messages: SseMessage[] = []
  const feed = createSseParser((message) => messages.push(message))
  chunks.forEach(feed)
  return messages
}

const one = { id: '43', event: 'node.updated', data: '{"a":1}' }

describe('SSE 읽기 (WHATWG)', () => {
  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])('줄 끝 %s', (_name, end) => {
    expect(parse(`id: 43${end}event: node.updated${end}data: {"a":1}${end}${end}`)).toEqual([one])
  })

  it('CRLF가 조각 사이에서 갈려도 메시지를 한 번만 만든다', () => {
    expect(parse('id: 43\r', '\nevent: node.updated\r\ndata: {"a":1}\r\n\r', '\n')).toEqual([one])
  })

  it('글자 하나씩 와도 읽는다', () => {
    expect(parse(...'id: 43\r\nevent: node.updated\r\ndata: {"a":1}\r\n\r\n'.split(''))).toEqual([one])
  })

  it('주석과 모르는 필드는 건너뛰고 여러 data 줄은 잇는다', () => {
    expect(parse(': ping\n\nretry: 10\ndata: a\ndata: b\n\n')).toEqual([{ id: null, event: 'message', data: 'a\nb' }])
  })

  it('콜론 뒤 공백은 하나만 뗀다', () => {
    expect(parse('data:x\n\ndata:  y\n\n').map((m) => m.data)).toEqual(['x', ' y'])
  })

  it('맨 앞 BOM을 무시하고, 끝나지 않은 메시지는 버린다', () => {
    expect(parse('﻿data: a\n\ndata: 끝나지 않음\n')).toEqual([{ id: null, event: 'message', data: 'a' }])
  })

  it('id는 그 메시지의 것만 돌려준다', () => {
    const messages = parse('id: 1\ndata: a\n\nevent: heartbeat\ndata: b\n\n')
    expect(messages.map((m) => m.id)).toEqual(['1', null])
  })
})
