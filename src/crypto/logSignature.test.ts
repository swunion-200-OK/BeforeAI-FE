import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import type { LogLine } from '../api/types'
import { bytesToBase64 } from './encoding'
import { canonicalize } from './hashService'
import { verifyLogLineSignature } from './logSignature'

const REQUEST_ID = 'request-1'
const secretKey = new Uint8Array(32).fill(19)
const signingKey = bytesToBase64(ed25519.getPublicKey(secretKey))
const unsignedLine = {
  sequence: 7,
  at: '2026-11-05T00:00:00Z',
  taskId: 'task-1',
  message: '배포를 시작합니다',
}
const signature = bytesToBase64(
  ed25519.sign(
    new TextEncoder().encode(canonicalize({ requestId: REQUEST_ID, ...unsignedLine })),
    secretKey,
  ),
)
const signedLine: LogLine = { ...unsignedLine, webshellSignature: signature }

describe('실행 로그 서명', () => {
  it('요청 ID와 로그 내용이 서명과 일치하면 통과한다', () => {
    expect(verifyLogLineSignature(REQUEST_ID, signedLine, signingKey)).toBe(true)
  })

  it('요청 ID 또는 로그 내용이 바뀌면 실패한다', () => {
    expect(verifyLogLineSignature('request-2', signedLine, signingKey)).toBe(false)
    expect(
      verifyLogLineSignature(
        REQUEST_ID,
        { ...signedLine, message: '변조된 로그' },
        signingKey,
      ),
    ).toBe(false)
  })
})
