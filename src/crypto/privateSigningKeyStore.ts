export interface PrivateSigningKeyRecord {
  userId: string
  privateKey: CryptoKey
  publicKey: string
}

const DATABASE_NAME = 'beforeai-device-keys'
const DATABASE_VERSION = 1
const STORE_NAME = 'signing-keys'

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise

  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('이 브라우저는 안전한 승인 키 저장소를 지원하지 않습니다. 최신 브라우저에서 다시 시도해 주세요.'))
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'userId' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        databasePromise = null
      }
      resolve(database)
    }
    request.onerror = () => {
      databasePromise = null
      reject(new Error('승인 키 저장소를 열지 못했습니다. 브라우저 저장 공간 설정을 확인해 주세요.', { cause: request.error }))
    }
    request.onblocked = () => {
      databasePromise = null
      reject(new Error('다른 탭이 승인 키 저장소를 사용 중입니다. 다른 탭을 닫고 다시 시도해 주세요.'))
    }
  })

  return databasePromise
}

function transactionResult<T>(transaction: IDBTransaction, request?: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let result: T | undefined
    if (request) {
      request.onsuccess = () => {
        result = request.result
      }
      request.onerror = () => reject(request.error ?? new Error('승인 키 저장소를 읽지 못했습니다.'))
    }
    transaction.oncomplete = () => resolve(result)
    transaction.onerror = () => reject(transaction.error ?? new Error('승인 키 저장소 작업에 실패했습니다.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('승인 키 저장소 작업이 중단되었습니다.'))
  })
}

export const privateSigningKeyStore = {
  async get(userId: string): Promise<PrivateSigningKeyRecord | null> {
    const database = await openDatabase()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(userId) as IDBRequest<PrivateSigningKeyRecord | undefined>
    return (await transactionResult(transaction, request)) ?? null
  },

  async put(record: PrivateSigningKeyRecord): Promise<void> {
    const database = await openDatabase()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(record)
    await transactionResult(transaction)
  },

  async delete(userId: string): Promise<void> {
    const database = await openDatabase()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(userId)
    await transactionResult(transaction)
  },

  async clear(): Promise<void> {
    if (!globalThis.indexedDB) return
    const database = await openDatabase()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).clear()
    await transactionResult(transaction)
  },
}
