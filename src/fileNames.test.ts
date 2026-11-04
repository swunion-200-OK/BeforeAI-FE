import { expect, it } from 'vitest'

// 맥과 윈도우는 파일 이름의 대소문자를 구분하지 않는다. 같은 폴더에 Foo.tsx와 foo.ts가 있으면
// './Foo'가 foo.ts로 연결되어 그 화면이 깨지는데, 리눅스에서는 재현되지 않아 시험으로 막는다.
it('같은 폴더에 대소문자만 다른 파일 이름이 없다', () => {
  const groups = new Map<string, Set<string>>()
  for (const path of Object.keys(import.meta.glob('./**/*.{ts,tsx,css}'))) {
    const name = path.replace(/\.[^./]+$/, '')
    const key = name.toLowerCase()
    groups.set(key, (groups.get(key) ?? new Set()).add(name))
  }
  const collisions = [...groups.values()].filter((names) => names.size > 1).map((names) => [...names])
  expect(collisions).toEqual([])
})
