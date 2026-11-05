import { describe, expect, it } from 'vitest'
import { clarificationLines } from './clarification'

describe('clarificationLines', () => {
  it('번호 앞에서 나눈다', () => {
    expect(clarificationLines('몇 가지 확인합니다. 1) 버전은? 2) 배포 방식은?')).toEqual(['몇 가지 확인합니다.', '1) 버전은?', '2) 배포 방식은?'])
  })
  it('줄바꿈을 우선한다', () => {
    expect(clarificationLines('질문입니다\n- 첫째\n- 둘째')).toEqual(['질문입니다', '첫째', '둘째'])
  })
  it('한 문장은 그대로 둔다', () => {
    expect(clarificationLines('어느 서버에 배포할까요?')).toEqual(['어느 서버에 배포할까요?'])
  })
})
