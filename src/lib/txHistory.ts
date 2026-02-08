// Transaction history — localStorage persistence layer

export type TxType = 'payment' | 'fund' | 'withdraw' | 'earn_deposit' | 'earn_withdraw'
export type TxStatus = 'pending' | 'completed' | 'failed'

export interface TxRecord {
  id: string
  type: TxType
  status: TxStatus
  timestamp: number // Unix ms
  // Amount
  asset: string // Yellow Network asset (e.g. 'usdc', 'ytest.usd')
  amount: string // human-readable
  // Payment fields
  recipient?: string // ENS/DNS name or address as entered
  recipientAddress?: string // resolved 0x address
  // Wallet/Fund fields (LI.FI swap)
  sourceToken?: string // source token symbol
  sourceAmount?: string
  sourceChain?: string
  txHash?: string // on-chain transaction hash
  // Withdraw fields
  channelId?: string
  // Earn fields
  vaultId?: string
  vaultName?: string
  yieldEarned?: string
}

const STORAGE_KEY = 'yellowpay_tx_history'
const MAX_RECORDS = 200

function readAll(): TxRecord[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as TxRecord[]
  } catch {
    return []
  }
}

function writeAll(records: TxRecord[]): void {
  if (typeof window === 'undefined') return
  try {
    // Keep only the most recent records
    const trimmed = records.slice(0, MAX_RECORDS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/** Add a new transaction record (prepends to list, newest first) */
export function addTx(record: Omit<TxRecord, 'id' | 'timestamp'>): TxRecord {
  const full: TxRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  }
  const records = readAll()
  records.unshift(full)
  writeAll(records)
  return full
}

/** Update an existing record by ID (e.g., mark as completed/failed) */
export function updateTx(id: string, updates: Partial<TxRecord>): void {
  const records = readAll()
  const idx = records.findIndex(r => r.id === id)
  if (idx === -1) return
  records[idx] = { ...records[idx], ...updates }
  writeAll(records)
}

/** Get all records, optionally filtered by wallet address */
export function getTxHistory(walletAddress?: string): TxRecord[] {
  const records = readAll()
  if (!walletAddress) return records
  // No wallet-level filtering needed since localStorage is per-browser
  // and we don't store the sender address. Could add later if needed.
  return records
}

/** Get a single record by ID */
export function getTx(id: string): TxRecord | undefined {
  return readAll().find(r => r.id === id)
}

/** Clear all history */
export function clearTxHistory(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}
