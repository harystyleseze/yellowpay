'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  getTxHistory,
  addTx,
  updateTx,
  clearTxHistory,
  type TxRecord,
} from '@/lib/txHistory'

/**
 * React hook for transaction history.
 * Reads from localStorage on mount and exposes helpers to add/update records.
 * Components call `refresh()` or the returned `add`/`update` to keep in sync.
 */
export function useTxHistory() {
  const [records, setRecords] = useState<TxRecord[]>([])

  // Load on mount (client-only)
  useEffect(() => {
    setRecords(getTxHistory())
  }, [])

  const refresh = useCallback(() => {
    setRecords(getTxHistory())
  }, [])

  const add = useCallback((record: Omit<TxRecord, 'id' | 'timestamp'>) => {
    const created = addTx(record)
    setRecords(getTxHistory())
    return created
  }, [])

  const update = useCallback((id: string, updates: Partial<TxRecord>) => {
    updateTx(id, updates)
    setRecords(getTxHistory())
  }, [])

  const clear = useCallback(() => {
    clearTxHistory()
    setRecords([])
  }, [])

  return { records, add, update, refresh, clear }
}
