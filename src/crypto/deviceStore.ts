/** 이 브라우저에 보관하는 승인 키 메타데이터와 고정해 둔 웹쉘 공개키. */

import type { WebshellPublicKey } from '../api/types'
import { privateSigningKeyStore } from './privateSigningKeyStore'

export interface DeviceEntry {
  keyId?: string
  publicKey?: string
  keyMigrationStatus?: 'NEEDS_REENROLLMENT'
  /** 내부망에서 키를 등록할 때 고정한 값. 웹 서비스가 나중에 내려 주는 키로 바꾸지 않는다 */
  pinnedWebshellKey?: WebshellPublicKey
}

interface LegacyDeviceEntry extends DeviceEntry {
  secretKey?: string
}

// 개인키 없는 기기 메타데이터만 둔다. v2의 개인키는 startup migration에서 IndexedDB로 옮긴다.
const STORAGE_KEY = 'beforeai.device.v3'
const LEGACY_STORAGE_KEY = 'beforeai.device.v2'

function readStorage(storageKey: string): Record<string, LegacyDeviceEntry> {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? '{}')
  } catch {
    return {}
  }
}

function read(): Record<string, DeviceEntry> {
  const stored = readStorage(STORAGE_KEY)
  return Object.fromEntries(
    Object.entries(stored).map(([userId, entry]) => {
      const metadata = { ...entry }
      delete metadata.secretKey
      return [userId, metadata]
    }),
  )
}

function write(data: Record<string, DeviceEntry>) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // 저장소를 쓸 수 없으면 새로고침 전까지 memoryFallback만 쓴다.
  }
}

function removeLegacyStorage() {
  const storage = globalThis.localStorage
  if (!storage) return
  try {
    storage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // 아래에서 빈 객체로 덮어써 개인키 원문을 제거한다.
  }
  if (storage.getItem(LEGACY_STORAGE_KEY) !== null) {
    try {
      storage.setItem(LEGACY_STORAGE_KEY, '{}')
    } catch {
      throw new Error('기존 승인 개인키를 안전하게 지우지 못했습니다. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.')
    }
    if (storage.getItem(LEGACY_STORAGE_KEY) !== '{}') {
      throw new Error('기존 승인 개인키를 안전하게 지우지 못했습니다. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.')
    }
    try {
      storage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // '{}'만 남아 있어 개인키 원문은 보관되지 않는다.
    }
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

  /** v2는 개인키 이전에만 읽는다. 호출자는 작업이 끝난 뒤 반드시 legacy storage를 제거해야 한다. */
  readLegacyEntries(): Record<string, LegacyDeviceEntry> {
    return readStorage(LEGACY_STORAGE_KEY)
  },

  discardLegacyStorage() {
    removeLegacyStorage()
  },

  /** IndexedDB에 키를 저장했거나 재등록이 필요하다고 표시한 뒤, 키가 없는 메타데이터만 남긴다. */
  completeLegacyMigration(entries: Record<string, DeviceEntry>) {
    const current = read()
    for (const [userId, entry] of Object.entries(entries)) {
      current[userId] = { ...current[userId], ...entry }
    }
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(current))
    removeLegacyStorage()
  },

  async clear() {
    memoryFallback = null
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY)
    } catch {
      // 지울 저장소가 없으면 할 일도 없다.
    }
    removeLegacyStorage()
    await privateSigningKeyStore.clear()
  },
}
