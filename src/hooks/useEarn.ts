'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAccount } from 'wagmi'
import { formatUnits } from 'viem'
import { earn } from '@/lib/earn'
import { publicClients, ERC20_ABI } from '@/lib/earn/client'
import type { EarnPosition } from '@/lib/earn'

// ─── localStorage deposit tracking (production only) ───

const DEPOSITS_STORAGE_KEY = 'yellowpay_earn_deposits'

interface StoredEarnDeposit {
  vaultId: string
  aTokenAddress: string
  chainId: number
  amount: string       // human-readable deposited amount (cumulative)
  decimals: number
  tokenAddress: string // underlying token address
  asset: string        // Yellow Network asset name
  timestamp: number    // Unix ms of first deposit
}

function getEarnDeposits(): StoredEarnDeposit[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(DEPOSITS_STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as StoredEarnDeposit[]
  } catch {
    return []
  }
}

function saveEarnDeposits(deposits: StoredEarnDeposit[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(DEPOSITS_STORAGE_KEY, JSON.stringify(deposits))
  } catch {
    // localStorage full or unavailable
  }
}

export function addEarnDeposit(
  vaultId: string,
  aTokenAddress: string,
  chainId: number,
  amount: string,
  decimals: number,
  tokenAddress: string,
  asset: string,
): void {
  const deposits = getEarnDeposits()
  const existing = deposits.find(
    d => d.aTokenAddress.toLowerCase() === aTokenAddress.toLowerCase() && d.chainId === chainId
  )

  if (existing) {
    // Accumulate deposit amounts
    const prev = parseFloat(existing.amount)
    const added = parseFloat(amount)
    existing.amount = (prev + added).toString()
  } else {
    deposits.push({
      vaultId,
      aTokenAddress,
      chainId,
      amount,
      decimals,
      tokenAddress,
      asset,
      timestamp: Date.now(),
    })
  }

  saveEarnDeposits(deposits)
}

export function removeEarnDeposit(aTokenAddress: string, chainId: number): void {
  const deposits = getEarnDeposits()
  const filtered = deposits.filter(
    d => !(d.aTokenAddress.toLowerCase() === aTokenAddress.toLowerCase() && d.chainId === chainId)
  )
  saveEarnDeposits(filtered)
}

// ─── Vaults Hook ───
// Fetches available vaults on mount (single fetch, cached via ref)

export function useEarnVaults() {
  const [vaults, setVaults] = useState<EarnPosition['vault'][]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    setIsLoading(true)
    earn.getVaults()
      .then(setVaults)
      .catch(err => {
        const msg = err instanceof Error ? err.message : 'Failed to fetch vaults'
        setError(msg)
      })
      .finally(() => setIsLoading(false))
  }, [])

  return { vaults, isLoading, error }
}

// ─── Positions Hook ───
// Reads aToken balances on-chain + localStorage deposits

export function useEarnPositions() {
  const [positions, setPositions] = useState<EarnPosition[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()
  const { address } = useAccount()
  const { vaults } = useEarnVaults()

  const fetchPositions = useCallback(async () => {
    // Production: read on-chain aToken balances
    if (!address) {
      setPositions([])
      return
    }

    const deposits = getEarnDeposits()
    if (deposits.length === 0) {
      setPositions([])
      return
    }

    try {
      const positionResults = await Promise.allSettled(
        deposits.map(async (deposit) => {
          const client = publicClients[deposit.chainId]
          if (!client) return null

          // Read aToken balance (includes accrued yield)
          const balance = await client.readContract({
            address: deposit.aTokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address as `0x${string}`],
          }) as bigint

          const currentAmount = parseFloat(formatUnits(balance, deposit.decimals))
          const depositedAmount = parseFloat(deposit.amount)
          const accruedYield = Math.max(0, currentAmount - depositedAmount)

          // Find matching vault for metadata
          const vault = vaults.find(v => v.id === deposit.vaultId) || {
            id: deposit.vaultId,
            name: `Aave V3 ${deposit.asset.toUpperCase()}`,
            protocol: 'Aave V3',
            asset: deposit.asset,
            apyPercent: 0,
            riskLevel: 'low' as const,
            description: '',
            minDeposit: 0,
            chainId: deposit.chainId,
            tokenAddress: deposit.tokenAddress,
            aTokenAddress: deposit.aTokenAddress,
            tokenDecimals: deposit.decimals,
          }

          const position: EarnPosition = {
            id: `pos-${deposit.aTokenAddress}-${deposit.chainId}`,
            vault,
            depositedAmount,
            currentAmount,
            accruedYield,
            depositTimestamp: deposit.timestamp,
            asset: deposit.asset,
            status: currentAmount > 0 ? 'active' : 'withdrawn',
          }

          return position
        })
      )

      const validPositions: EarnPosition[] = []
      for (const result of positionResults) {
        if (result.status === 'fulfilled' && result.value && result.value.currentAmount > 0) {
          validPositions.push(result.value)
        }
      }

      setPositions(validPositions)
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch positions'
      setError(msg)
    }
  }, [address, vaults])

  useEffect(() => {
    setIsLoading(true)
    fetchPositions().finally(() => setIsLoading(false))

    // Auto-refresh every 15s
    intervalRef.current = setInterval(fetchPositions, 15_000)

    return () => clearInterval(intervalRef.current)
  }, [fetchPositions])

  return { positions, isLoading, error, refresh: fetchPositions }
}
