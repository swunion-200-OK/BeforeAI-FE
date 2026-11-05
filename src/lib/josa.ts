/** 받침이 있는 숫자: 1(일) 3(삼) 6(육) 7(칠) 8(팔) 0(영) */
const DIGIT_FINAL = '136780'
/** 받침이 ㄹ인 숫자: 1(일) 7(칠) 8(팔). "으로" 대신 "로"를 쓴다 */
const DIGIT_RIEUL = '178'
/** 받침으로 읽히는 영문자: L(엘) M(엠) N(엔) R(알) */
const LATIN_FINAL = 'LMNR'
const LATIN_RIEUL = 'LR'
const RIEUL_CODA = 8

type Ending = 'none' | 'final' | 'rieul' | 'unknown'

function endingOf(word: string): Ending {
  const last = word[word.length - 1] ?? ''
  const code = last.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) {
    const coda = (code - 0xac00) % 28
    return coda === 0 ? 'none' : coda === RIEUL_CODA ? 'rieul' : 'final'
  }
  if (/[0-9]/.test(last)) return DIGIT_RIEUL.includes(last) ? 'rieul' : DIGIT_FINAL.includes(last) ? 'final' : 'none'
  const upper = last.toUpperCase()
  if (/[A-Z]/.test(upper)) return LATIN_RIEUL.includes(upper) ? 'rieul' : LATIN_FINAL.includes(upper) ? 'final' : 'none'
  return 'unknown'
}

/** 앞말에 맞는 조사만 돌려준다. 읽는 법을 모르는 글자로 끝나면 둘 다 쓴다. */
export function particle(word: string, withFinal: string, withoutFinal: string): string {
  const ending = endingOf(word)
  if (ending === 'unknown') return `${withFinal}(${withoutFinal})`
  return ending === 'none' ? withoutFinal : withFinal
}

/** "박CTO가", "내용을"처럼 앞말과 조사를 붙인다. */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  return `${word}${particle(word, withFinal, withoutFinal)}`
}

/** "v4로", "v3으로". 받침이 ㄹ이면 "으로"가 아니라 "로"다. */
export function withRo(word: string): string {
  const ending = endingOf(word)
  if (ending === 'unknown') return `${word}(으)로`
  return `${word}${ending === 'final' ? '으로' : '로'}`
}
