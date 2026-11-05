import { USE_MOCK } from '../api/client'

/** 실제 서버에는 Slack 연동이 없다 (api/missingOnServer.ts). 목에서는 시연하므로 그대로 둔다. */
export function withoutSlackOnServer<T>(items: readonly T[], isSlack: (item: T) => boolean, mock = USE_MOCK): T[] {
  return mock ? [...items] : items.filter((item) => !isSlack(item))
}
