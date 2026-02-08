'use client'

import { useState } from 'react'
import { useTxHistory } from '@/hooks/useTxHistory'
import { getAssetLabel } from '@/lib/constants'
import type { TxRecord, TxType } from '@/lib/txHistory'

const TYPE_LABELS: Record<TxType, string> = {
  payment: 'Payment',
  fund: 'Deposit',
  withdraw: 'Withdrawal',
  earn_deposit: 'Earn Deposit',
  earn_withdraw: 'Earn Withdraw',
}

const TYPE_COLORS: Record<TxType, string> = {
  payment: 'text-blue-400 bg-blue-900/20 border-blue-800/50',
  fund: 'text-yellow-400 bg-yellow-900/20 border-yellow-800/50',
  withdraw: 'text-purple-400 bg-purple-900/20 border-purple-800/50',
  earn_deposit: 'text-emerald-400 bg-emerald-900/20 border-emerald-800/50',
  earn_withdraw: 'text-teal-400 bg-teal-900/20 border-teal-800/50',
}

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-yellow-400',
  completed: 'bg-green-400',
  failed: 'bg-red-400',
}

type FilterType = 'all' | TxType

export function TxHistory() {
  const { records, clear } = useTxHistory()
  const [filter, setFilter] = useState<FilterType>('all')

  const filtered = filter === 'all'
    ? records
    : records.filter(r => r.type === filter)

  if (records.length === 0) {
    return (
      <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
        <div className="text-center py-8">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-800 flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm">No transactions yet</p>
          <p className="text-gray-500 text-xs mt-1">
            Your payments, deposits, and withdrawals will appear here
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-4">
      {/* Filter tabs + clear */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {(['all', 'payment', 'fund', 'withdraw', 'earn_deposit', 'earn_withdraw'] as FilterType[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                filter === f
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {f === 'all' ? 'All' : TYPE_LABELS[f]}
              {f === 'all' && ` (${records.length})`}
            </button>
          ))}
        </div>
        <button
          onClick={clear}
          className="text-xs text-gray-500 hover:text-red-400 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Transaction list */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            No {filter === 'all' ? '' : TYPE_LABELS[filter as TxType].toLowerCase()} transactions
          </p>
        ) : (
          filtered.map(record => (
            <TxRow key={record.id} record={record} />
          ))
        )}
      </div>

      {/* Summary */}
      <div className="pt-2 border-t border-gray-800">
        <p className="text-xs text-gray-500 text-center">
          {records.length} transaction{records.length !== 1 ? 's' : ''} stored locally
        </p>
      </div>
    </div>
  )
}

function TxRow({ record }: { record: TxRecord }) {
  const [expanded, setExpanded] = useState(false)
  const time = formatTime(record.timestamp)
  const assetLabel = getAssetLabel(record.asset)

  return (
    <div
      className="p-3 bg-gray-800/60 rounded-lg border border-gray-700/50 cursor-pointer hover:border-gray-600/50 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      {/* Main row */}
      <div className="flex items-center gap-3">
        {/* Type badge */}
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${TYPE_COLORS[record.type]}`}>
          {TYPE_LABELS[record.type]}
        </span>

        {/* Amount + asset */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium truncate">
            {record.type === 'payment' && record.recipient && (
              <span className="text-gray-400 font-normal">to </span>
            )}
            {record.type === 'payment' && record.recipient ? (
              <span>{record.recipient}</span>
            ) : record.type === 'fund' && record.sourceToken ? (
              <span>{record.sourceAmount} {record.sourceToken} → {record.amount} {assetLabel}</span>
            ) : (record.type === 'earn_deposit' || record.type === 'earn_withdraw') && record.vaultName ? (
              <span>{record.amount} {assetLabel} &bull; {record.vaultName}</span>
            ) : (
              <span>{record.amount} {assetLabel}</span>
            )}
          </p>
          {record.type === 'payment' && record.recipient && (
            <p className="text-xs text-gray-500 truncate">
              {record.amount} {assetLabel}
            </p>
          )}
          {record.type === 'earn_withdraw' && record.yieldEarned && (
            <p className="text-xs text-emerald-500 truncate">
              +{record.yieldEarned} {assetLabel} yield
            </p>
          )}
        </div>

        {/* Status + time */}
        <div className="flex-shrink-0 text-right">
          <div className="flex items-center gap-1.5 justify-end">
            <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[record.status]}`} />
            <span className="text-[10px] text-gray-500 capitalize">{record.status}</span>
          </div>
          <p className="text-[10px] text-gray-600 mt-0.5">{time}</p>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 pt-2 border-t border-gray-700/50 space-y-1">
          {record.recipientAddress && (
            <Detail label="Address" value={truncateAddr(record.recipientAddress)} />
          )}
          {record.sourceChain && (
            <Detail label="Source chain" value={record.sourceChain} />
          )}
          {record.txHash && (
            <Detail label="TX hash" value={truncateAddr(record.txHash)} />
          )}
          {record.channelId && (
            <Detail label="Channel" value={truncateAddr(record.channelId)} />
          )}
          {record.vaultName && (
            <Detail label="Vault" value={record.vaultName} />
          )}
          {record.yieldEarned && (
            <Detail label="Yield earned" value={`+${record.yieldEarned}`} />
          )}
          <Detail label="Time" value={new Date(record.timestamp).toLocaleString()} />
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[10px] text-gray-500">{label}</span>
      <span className="text-[10px] text-gray-400 font-mono">{value}</span>
    </div>
  )
}

function truncateAddr(addr: string): string {
  if (addr.length <= 16) return addr
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}
