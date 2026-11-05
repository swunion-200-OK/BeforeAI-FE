import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { requestsApi } from '../../api/endpoints'
import type { ProgressTree } from '../../api/types'
import { createProgressSync } from './progressSync'

/** 트리를 받고 스트림으로 이어 간다. retry는 트리를 다시 받고 끊긴 스트림도 다시 연다. */
export function useProgressTree(requestId: string) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['progress', requestId],
    queryFn: () => requestsApi.progress(requestId),
  })
  const ready = query.data !== undefined
  const [connection, setConnection] = useState(0)
  const { refetch } = query
  const retry = useCallback(() => {
    setConnection((value) => value + 1)
    return refetch()
  }, [refetch])

  useEffect(() => {
    if (!ready) return
    const queryKey = ['progress', requestId]
    const sync = createProgressSync({
      getTree: () => client.getQueryData<ProgressTree>(queryKey),
      setTree: (tree) => client.setQueryData(queryKey, tree),
      fetchTree: () => client.fetchQuery({ queryKey, queryFn: () => requestsApi.progress(requestId), staleTime: 0 }),
      openStream: (onEvent, signal, lastVersion) => requestsApi.streamProgress(requestId, onEvent, signal, lastVersion),
    })
    sync.start()
    return () => sync.stop()
  }, [client, requestId, ready, connection])

  return { query, retry }
}
