import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 에이전트 도구가 수시로 쓰는 상태 파일이 바뀔 때 페이지가 새로고침되지 않게 한다.
    watch: { ignored: ['**/.omc/**'] },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
