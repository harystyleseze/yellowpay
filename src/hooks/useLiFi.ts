'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { usePublicClient } from 'wagmi'
import { lifi } from '@/lib/lifi'
import type {
  LiFiQuote,
  LiFiQuoteRequest,
  LiFiChain,
  LiFiToken,
  LiFiStatus,
  LiFiStatusType,
} from '@/lib/lifi'

// ─── Quote Hook ───
// Fetches a swap/bridge quote with debouncing

export function useLiFiQuote() {
  const [quote, setQuote] = useState<LiFiQuote | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(0)

  const fetchQuote = useCallback(async (params: LiFiQuoteRequest) => {
    const requestId = ++abortRef.current
    setIsLoading(true)
    setError(null)
    setQuote(null)

    try {
      const result = await lifi.getQuote(params)

      // Only update if this is still the latest request
      if (requestId === abortRef.current) {
        setQuote(result)
      }
      return result
    } catch (e) {
      if (requestId === abortRef.current) {
        const message = e instanceof Error ? e.message : 'Failed to fetch quote'
        setError(message)
      }
      return null
    } finally {
      if (requestId === abortRef.current) {
        setIsLoading(false)
      }
    }
  }, [])

  const clearQuote = useCallback(() => {
    abortRef.current++
    setQuote(null)
    setError(null)
    setIsLoading(false)
  }, [])

  return { quote, isLoading, error, fetchQuote, clearQuote }
}

// ─── Chains Hook ───
// Fetches and caches supported chains

export function useLiFiChains() {
  const [chains, setChains] = useState<LiFiChain[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    setIsLoading(true)
    lifi.getChains()
      .then(setChains)
      .catch(err => console.error('Failed to fetch chains:', err))
      .finally(() => setIsLoading(false))
  }, [])

  // Set of supported chain IDs for fast lookup
  const supportedChainIds = useMemo(
    () => new Set(chains.map(c => c.id)),
    [chains]
  )

  return { chains, isLoading, supportedChainIds }
}

// ─── Tokens Hook ───
// Fetches tokens for specific chain(s) with caching

const tokenCache = new Map<string, Record<number, LiFiToken[]>>()

export function useLiFiTokens(chainIds: number[], supportedChainIds?: Set<number>) {
  const [tokens, setTokens] = useState<Record<number, LiFiToken[]>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter to only supported chains (prevents calling real LI.FI API with testnet IDs)
  const validChainIds = useMemo(() => {
    if (!supportedChainIds || supportedChainIds.size === 0) return chainIds
    return chainIds.filter(id => supportedChainIds.has(id))
  }, [chainIds, supportedChainIds])

  const cacheKey = validChainIds.sort().join(',')

  useEffect(() => {
    if (!validChainIds.length) {
      setTokens({})
      // Show error if original chainIds had values but none were valid
      if (chainIds.length > 0 && supportedChainIds && supportedChainIds.size > 0) {
        setError('Selected chain is not supported. Please switch to a supported chain.')
      } else {
        setError(null)
      }
      return
    }

    setError(null)

    // Check cache
    const cached = tokenCache.get(cacheKey)
    if (cached) {
      setTokens(cached)
      return
    }

    setIsLoading(true)
    lifi.getTokens(validChainIds)
      .then(result => {
        tokenCache.set(cacheKey, result)
        setTokens(result)
      })
      .catch(err => {
        console.error('Failed to fetch tokens:', err)
        setError('Failed to load tokens for this chain.')
      })
      .finally(() => setIsLoading(false))
  }, [cacheKey, validChainIds, chainIds, supportedChainIds])

  return { tokens, isLoading, error }
}

// ─── Transaction Status Hook ───
// Polls transfer status until terminal state (DONE or FAILED)

export function useTransactionStatus(
  txHash: string | null,
  fromChain: number,
  toChain: number,
  bridge?: string,
) {
  const [status, setStatus] = useState<LiFiStatus | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()
  const publicClient = usePublicClient({ chainId: fromChain || undefined })

  useEffect(() => {
    if (!txHash) {
      setStatus(null)
      setIsPolling(false)
      return
    }

    const isSameChain = fromChain === toChain && fromChain > 0
    const TERMINAL_STATES: LiFiStatusType[] = ['DONE', 'FAILED']
    setIsPolling(true)

    const poll = async () => {
      try {
        // Same-chain swaps: check on-chain receipt directly instead of LI.FI status API.
        // LI.FI's status endpoint is designed for cross-chain bridge tracking and returns
        // NOT_FOUND/PENDING indefinitely for same-chain DEX swaps.
        if (isSameChain && publicClient) {
          try {
            const receipt = await publicClient.getTransactionReceipt({
              hash: txHash as `0x${string}`,
            })
            const result: LiFiStatus = {
              status: receipt.status === 'success' ? 'DONE' : 'FAILED',
              substatus: 'COMPLETED',
              fromChain,
              toChain,
              txHash,
            }
            setStatus(result)
            clearInterval(intervalRef.current)
            setIsPolling(false)
            return
          } catch {
            // Receipt not available yet (tx not mined) — retry on next interval
            return
          }
        }

        // Cross-chain: use LI.FI status API polling
        const result = await lifi.getStatus(txHash, fromChain, toChain, bridge)
        setStatus(result)

        if (TERMINAL_STATES.includes(result.status)) {
          clearInterval(intervalRef.current)
          setIsPolling(false)
        }
      } catch {
        // Retry on next interval
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 5_000) // Poll every 5s

    return () => {
      clearInterval(intervalRef.current)
      setIsPolling(false)
    }
  }, [txHash, fromChain, toChain, bridge, publicClient])

  return { status, isPolling }
}
