import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 개발 서버 전용. 브라우저가 같은 출처로 부르게 해 CORS 없이 서버에 붙는다 (.env.example 참고).
  const proxyTarget = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_PROXY_TARGET

  return {
    plugins: [react(), tailwindcss()],
    server: {
      // 에이전트 도구가 수시로 쓰는 상태 파일이 바뀔 때 페이지가 새로고침되지 않게 한다.
      watch: { ignored: ['**/.omc/**'] },
      proxy: proxyTarget
        ? {
            '/api': {
              target: proxyTarget,
              changeOrigin: true,
              // 서버 도메인에 묶인 리프레시 쿠키를 개발 서버 주소에서도 쓰게 한다.
              cookieDomainRewrite: '',
              // SSE는 오래 열려 있고, 압축되면 조각이 모여서 온다.
              timeout: 0,
              proxyTimeout: 0,
              headers: { 'Accept-Encoding': 'identity' },
              configure(proxy) {
                // 서버가 개발 서버 출처를 몰라도 CORS로 막히지 않게 한다.
                proxy.on('proxyReq', (request) => request.removeHeader('origin'))
              },
            },
          }
        : undefined,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
