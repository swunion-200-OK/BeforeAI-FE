import { describe, expect, it } from 'vitest'
import { josa, particle, withRo } from './josa'

describe('조사', () => {
  it.each([
    ['수정할 내용', '을', '를', '수정할 내용을'],
    ['사유', '을', '를', '사유를'],
    ['박CTO', '이', '가', '박CTO가'],
    ['김담당', '이', '가', '김담당이'],
    ['production', '이', '가', 'production이'],
    ['v1', '과', '와', 'v1과'],
    ['v2', '과', '와', 'v2와'],
  ])('%s + %s/%s', (word, withFinal, withoutFinal, expected) => {
    expect(josa(word, withFinal, withoutFinal)).toBe(expected)
  })

  it('읽는 법을 모르면 둘 다 쓴다', () => {
    expect(josa('x)', '이', '가')).toBe('x)이(가)')
  })

  it('따옴표 안의 말에 맞는 조사만 따로 얻는다', () => {
    expect(`"일괄 중단"${particle('일괄 중단', '을', '를')}`).toBe('"일괄 중단"을')
  })

  it.each([
    ['v4', 'v4로'],
    ['v3', 'v3으로'],
    ['v1', 'v1로'],
    ['서울', '서울로'],
    ['부산', '부산으로'],
    ['학교', '학교로'],
  ])('%s의 으로/로', (word, expected) => {
    expect(withRo(word)).toBe(expected)
  })
})
