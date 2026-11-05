import { x25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import type { ApprovalEnvelope, SignedApproval } from '../api/types'
import { cryptoService } from './cryptoService'
import { base64ToBytes, bytesToBase64 } from './encoding'

describe('웹쉘 공개키 확인', () => {
  const raw = new Uint8Array(32).fill(7)
  const publicKey = bytesToBase64(raw)
  const fingerprint = `sha256:${bytesToHex(sha256(raw))}`
  const valid = {
    encryption: { algorithm: 'X25519', publicKey, fingerprint },
    signing: { algorithm: 'Ed25519', publicKey, fingerprint },
  }

  it('서버 형식이면 통과한다', () => {
    expect(() => cryptoService.assertWebshellKey(valid)).not.toThrow()
  })

  it('지문이 다르면 고정하지 않는다', () => {
    const broken = { ...valid, signing: { ...valid.signing, fingerprint: 'sha256:00' } }
    expect(() => cryptoService.assertWebshellKey(broken)).toThrow('지문')
  })

  it('32바이트가 아니거나 알고리즘이 다르면 고정하지 않는다', () => {
    const long = bytesToBase64(new Uint8Array(44))
    const longKey = { ...valid, encryption: { ...valid.encryption, publicKey: long } }
    expect(() => cryptoService.assertWebshellKey(longKey)).toThrow('32바이트')
    const wrong = { ...valid, encryption: { ...valid.encryption, algorithm: 'Ed25519' } }
    expect(() => cryptoService.assertWebshellKey(wrong)).toThrow('X25519')
  })
})

const signed: SignedApproval = {
  payload: {
    planHash: 'sha256:abc',
    requestId: 'r-1',
    planId: 'p-1',
    taskIds: ['t-1'],
    approverId: 'u',
    keyId: 'k',
    issuedAt: '2026-11-05T00:00:00Z',
    nonce: 'n-한글',
    network: 'INTERNAL',
  },
  signature: 'c2ln',
}

function keyPair() {
  const secret = x25519.utils.randomSecretKey()
  return { secret, publicKey: bytesToBase64(x25519.getPublicKey(secret)) }
}

function flipByte(value: string, index: number): string {
  const bytes = base64ToBytes(value)
  bytes[index] ^= 0x01
  return bytesToBase64(bytes)
}

const OPEN_FAILED = '봉투를 열 수 없습니다'

describe('cryptoService: HPKE 봉투', () => {
  it('같은 키 쌍으로 암호화하고 연다', () => {
    const { secret, publicKey } = keyPair()
    const envelope = cryptoService.encryptForWebshell(signed, publicKey)
    expect(envelope.alg).toBe('HPKE-X25519-AES256GCM')
    expect(base64ToBytes(envelope.encapsulatedKey)).toHaveLength(32)
    expect(cryptoService.decryptForWebshell(envelope, secret)).toEqual(signed)
  })

  it('암호문에 평문이 보이지 않고, 같은 내용도 봉투마다 다르다', () => {
    const { publicKey } = keyPair()
    const first = cryptoService.encryptForWebshell(signed, publicKey)
    const second = cryptoService.encryptForWebshell(signed, publicKey)
    expect(new TextDecoder().decode(base64ToBytes(first.ciphertext))).not.toContain('sha256:abc')
    // 태그 16바이트가 평문 뒤에 붙는다.
    expect(base64ToBytes(first.ciphertext)).toHaveLength(new TextEncoder().encode(JSON.stringify(signed)).length + 16)
    expect(second.encapsulatedKey).not.toBe(first.encapsulatedKey)
    expect(second.ciphertext).not.toBe(first.ciphertext)
  })

  it('암호문이나 encapsulatedKey가 한 비트라도 바뀌면 열지 못한다', () => {
    const { secret, publicKey } = keyPair()
    const envelope = cryptoService.encryptForWebshell(signed, publicKey)
    const size = base64ToBytes(envelope.ciphertext).length
    for (const index of [0, size - 17, size - 1]) {
      const tampered = { ...envelope, ciphertext: flipByte(envelope.ciphertext, index) }
      expect(() => cryptoService.decryptForWebshell(tampered, secret)).toThrow(OPEN_FAILED)
    }
    const swapped = { ...envelope, encapsulatedKey: flipByte(envelope.encapsulatedKey, 0) }
    expect(() => cryptoService.decryptForWebshell(swapped, secret)).toThrow(OPEN_FAILED)
    const truncated = { ...envelope, ciphertext: bytesToBase64(base64ToBytes(envelope.ciphertext).slice(0, 8)) }
    expect(() => cryptoService.decryptForWebshell(truncated, secret)).toThrow(OPEN_FAILED)
  })

  it('다른 키로는 열지 못한다', () => {
    const envelope = cryptoService.encryptForWebshell(signed, keyPair().publicKey)
    expect(() => cryptoService.decryptForWebshell(envelope, keyPair().secret)).toThrow(OPEN_FAILED)
  })

  it('다른 알고리즘의 봉투는 거부한다', () => {
    const { secret, publicKey } = keyPair()
    const envelope = cryptoService.encryptForWebshell(signed, publicKey)
    const wrong = { ...envelope, alg: 'HPKE-X25519-CHACHA20' } as unknown as ApprovalEnvelope
    expect(() => cryptoService.decryptForWebshell(wrong, secret)).toThrow('지원하지 않는 봉투 알고리즘')
  })

  it('길이가 틀리거나 base64가 아닌 키는 거부한다', () => {
    const { secret, publicKey } = keyPair()
    // SPKI로 감싼 공개키가 오면 44바이트다.
    expect(() => cryptoService.encryptForWebshell(signed, bytesToBase64(new Uint8Array(44)))).toThrow('32바이트')
    expect(() => cryptoService.encryptForWebshell(signed, '')).toThrow('32바이트')
    expect(() => cryptoService.encryptForWebshell(signed, '!!!')).toThrow('base64')

    const envelope = cryptoService.encryptForWebshell(signed, publicKey)
    expect(() => cryptoService.decryptForWebshell(envelope, new Uint8Array(31))).toThrow('32바이트')
    expect(() => cryptoService.decryptForWebshell({ ...envelope, encapsulatedKey: 'x' }, secret)).toThrow('base64')
    expect(() => cryptoService.decryptForWebshell({ ...envelope, encapsulatedKey: 'AAAA' }, secret)).toThrow('32바이트')
    expect(() => cryptoService.decryptForWebshell({ ...envelope, ciphertext: '!!!' }, secret)).toThrow(OPEN_FAILED)
  })

  it('저차 공개키로는 암호화하지 않고, 그런 encapsulatedKey도 열지 않는다', () => {
    const lowOrder = bytesToBase64(new Uint8Array(32))
    expect(() => cryptoService.encryptForWebshell(signed, lowOrder)).toThrow('X25519 공개키')
    const { secret, publicKey } = keyPair()
    const envelope = cryptoService.encryptForWebshell(signed, publicKey)
    expect(() => cryptoService.decryptForWebshell({ ...envelope, encapsulatedKey: lowOrder }, secret)).toThrow(OPEN_FAILED)
  })

  it('공개키로 만든 봉투라도 안에 승인 서명이 없으면 거부한다', () => {
    const { secret, publicKey } = keyPair()
    // undefined는 빈 평문이 되어 JSON으로 읽히지 않는다.
    for (const content of [{ foo: 1 }, null, undefined, { payload: null, signature: 'x' }, { payload: {}, signature: 1 }]) {
      const envelope = cryptoService.encryptForWebshell(content as unknown as SignedApproval, publicKey)
      expect(() => cryptoService.decryptForWebshell(envelope, secret)).toThrow('승인 서명이 없습니다')
    }
  })

  it('다른 RFC 9180 구현(@hpke/core 1.10.0)이 봉한 고정 봉투를 연다', () => {
    const secret = new Uint8Array(32).map((_, i) => i + 1)
    expect(bytesToBase64(x25519.getPublicKey(secret))).toBe('B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=')
    const envelope: ApprovalEnvelope = {
      alg: 'HPKE-X25519-AES256GCM',
      encapsulatedKey: 'C/DDHNL5I8pngVG2wZmL8xyN5ej8BapK82DNZEjD3QE=',
      ciphertext:
        'U6BBdGuL+OwGUSgeREjH6/0Fd/R6ei/dmCzJ3XEpWn1WXtpZo7xJXWBABOvD4oeOuh5nndRAPkthTCLmuqfYVUW0RJkk+ofIrvC2VVuaoKxZDZxscidZWwsak5GlCQdWk00De181OISeE5EnU3d06sOXlM6/VBEHh1dFp/+zCLx9PYcmecYw6F9dShDnCIkpWQ4ztjRpjB8wq9GMI6PZ6BPtSPmo1WecSlljEiKHj/aq5d017j2KvYkbv38sqaoum2P25bU/zgq1ZP/wBtnIy4pMWe/FraUARjSKYwp8W+4sEQ==',
    }
    expect(cryptoService.decryptForWebshell(envelope, secret)).toEqual(signed)
  })
})
