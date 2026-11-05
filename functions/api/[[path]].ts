import { proxyToApi } from '../../src/api/pagesProxy'

interface Env {
  API_PROXY_TARGET?: string
}

export const onRequest = ({ request, env }: { request: Request; env: Env }) => proxyToApi(request, env.API_PROXY_TARGET)
