/**
 * crypto.randomUUID는 보안 컨텍스트(https, localhost)에서만 있다. 사내망의 http 주소에서는 없어서
 * 영어 오류로 서명이 멈춘다. getRandomValues는 어디서나 되므로 같은 형식(UUID v4)을 직접 만든다.
 */
export function randomUuid(source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = crypto): string {
  if (typeof source.randomUUID === 'function') return source.randomUUID()
  const bytes = source.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
