import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, matchRoutes, type RouteObject } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { RequireAuth } from './guards'
import NotFoundPage from './NotFoundPage'
import { AppShell } from './AppShell'

// 브라우저 라우터는 window가 있어야 만들어지므로 경로 표만 받는다.
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  createBrowserRouter: (routes: RouteObject[]) => routes,
}))

describe('없는 주소', () => {
  it('앱 뼈대 안의 안내로 가고, 로그인 전이면 로그인 확인을 먼저 지난다', async () => {
    const { router } = await import('./routes')
    const matches = matchRoutes(router as unknown as RouteObject[], '/nope/xyz') ?? []
    const elements = matches.map((match) => (match.route.element as ReactElement | undefined)?.type)
    expect(elements).toContain(RequireAuth)
    expect(elements).toContain(AppShell)
    expect(elements.at(-1)).toBe(NotFoundPage)
  })

  it('있는 주소는 그대로 그 화면으로 간다', async () => {
    const { router } = await import('./routes')
    expect(matchRoutes(router as unknown as RouteObject[], '/dashboard')?.at(-1)?.route.path).toBe('/dashboard')
    expect(matchRoutes(router as unknown as RouteObject[], '/login')?.at(-1)?.route.path).toBe('/login')
  })

  it('안내와 처음 화면으로 가는 링크를 보여 준다', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(NotFoundPage)))
    expect(html).toContain('찾을 수 없는 주소입니다')
    expect(html).toContain('href="/"')
  })
})
