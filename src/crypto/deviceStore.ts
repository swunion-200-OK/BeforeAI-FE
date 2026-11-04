/**
 * 이 기기에 보관하는 승인 키와 고정해 둔 실행기 공개키.
 * TODO(spec): 저장 방식은 명세에 없다. 운영에서는 내보낼 수 없는 키(WebCrypto + IndexedDB)로 바꿔야 한다.
 */

export interface DeviceEntry {
  keyId?: string
  secretKey?: string
  publicKey?: string
  pinnedExecutorKey?: string
}

const STORAGE_KEY = 'beforeai.device.v1'

function read(): Record<string, DeviceEntry> {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function write(data: Record<string, DeviceEntry>) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // 저장소를 쓸 수 없으면 새로고침 전까지 memoryFallback만 쓴다.
  }
}

let memoryFallback: Record<string, DeviceEntry> | null = null

function load(): Record<string, DeviceEntry> {
  if (!globalThis.localStorage) return (memoryFallback ??= {})
  return read()
}

export const deviceStore = {
  get(userId: string): DeviceEntry {
    return load()[userId] ?? {}
  },
  update(userId: string, patch: DeviceEntry) {
    const data = load()
    data[userId] = { ...data[userId], ...patch }
    if (globalThis.localStorage) write(data)
    else memoryFallback = data
  },
  clear() {
    memoryFallback = null
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY)
    } catch {
      // 지울 저장소가 없으면 할 일도 없다.
    }
  },
}
