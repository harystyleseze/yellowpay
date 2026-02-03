'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import type { Hex, Address } from 'viem'
import {
  createAuthRequestMessage,
  createAuthVerifyMessage,
  createGetLedgerBalancesMessage,
  createTransferMessage,
  createEIP712AuthMessageSigner,
  parseAuthChallengeResponse,
  parseAuthVerifyResponse,
  parseGetLedgerBalancesResponse,
  parseTransferResponse,
  parseAnyRPCResponse,
  type MessageSigner,
  type RPCBalance,
} from '@erc7824/nitrolite'

import { YELLOW_WS_ENDPOINT } from '@/lib/constants'

// Session state interface
interface YellowState {
  isConnected: boolean
  isAuthenticated: boolean
  balances: RPCBalance[]
  error: string | null
}

// Initial state
const initialState: YellowState = {
  isConnected: false,
  isAuthenticated: false,
  balances: [],
  error: null,
}

export function useYellow() {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()

  const [state, setState] = useState<YellowState>(initialState)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isSending, setIsSending] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const signerRef = useRef<MessageSigner | null>(null)

  // Create message signer from wallet client
  const createSigner = useCallback(async (): Promise<MessageSigner> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected')
    }

    // Create a simple message signer that signs the JSON payload
    const signer: MessageSigner = async (payload) => {
      const message = JSON.stringify(payload)
      const signature = await walletClient.signMessage({
        account: address,
        message,
      })
      return signature as Hex
    }

    return signer
  }, [walletClient, address])

  // Send message and wait for response
  const sendMessage = useCallback((message: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'))
        return
      }

      const handleMessage = (event: MessageEvent) => {
        wsRef.current?.removeEventListener('message', handleMessage)
        resolve(event.data)
      }

      wsRef.current.addEventListener('message', handleMessage)
      wsRef.current.send(message)

      // Timeout after 30 seconds
      setTimeout(() => {
        wsRef.current?.removeEventListener('message', handleMessage)
        reject(new Error('Request timeout'))
      }, 30000)
    })
  }, [])

  // Connect to Yellow Network
  const connect = useCallback(async () => {
    if (!address || !walletClient) {
      setState(prev => ({ ...prev, error: 'Wallet not connected' }))
      return
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return // Already connected
    }

    setIsConnecting(true)
    setState(prev => ({ ...prev, error: null }))

    try {
      // Create WebSocket connection
      const ws = new WebSocket(YELLOW_WS_ENDPOINT)
      wsRef.current = ws

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = (e) => reject(new Error('WebSocket connection failed'))
        ws.onclose = () => {
          setState(prev => ({
            ...prev,
            isConnected: false,
            isAuthenticated: false,
          }))
        }
      })

      setState(prev => ({ ...prev, isConnected: true }))

      // Create signer
      const signer = await createSigner()
      signerRef.current = signer

      // Step 1: Send auth request
      const authRequestMsg = await createAuthRequestMessage({
        address: address as Address,
        session_key: address as Address,
        application: 'yellowpay',
        allowances: [{ asset: 'usdc', amount: '1000000' }],
        expires_at: BigInt(Math.floor(Date.now() / 1000) + 86400), // 24 hours
        scope: 'console',
      })

      const challengeResponse = await sendMessage(authRequestMsg)
      const challenge = parseAuthChallengeResponse(challengeResponse)

      // Step 2: Sign challenge and verify
      const authVerifyMsg = await createAuthVerifyMessage(
        signer,
        challenge,
      )

      const verifyResponse = await sendMessage(authVerifyMsg)
      const verifyResult = parseAuthVerifyResponse(verifyResponse)

      if (verifyResult.result?.jwt) {
        setState(prev => ({ ...prev, isAuthenticated: true }))

        // Fetch initial balances
        await fetchBalances()
      } else {
        throw new Error('Authentication failed')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      setState(prev => ({ ...prev, error: message }))
      wsRef.current?.close()
      wsRef.current = null
    } finally {
      setIsConnecting(false)
    }
  }, [address, walletClient, createSigner, sendMessage])

  // Fetch balances
  const fetchBalances = useCallback(async () => {
    if (!signerRef.current || !wsRef.current) return

    try {
      const balanceMsg = await createGetLedgerBalancesMessage(signerRef.current)
      const response = await sendMessage(balanceMsg)
      const balances = parseGetLedgerBalancesResponse(response)

      setState(prev => ({
        ...prev,
        balances: balances.result || [],
      }))
    } catch (error) {
      console.error('Failed to fetch balances:', error)
    }
  }, [sendMessage])

  // Send payment
  const sendPayment = useCallback(async (
    recipientAddress: Address,
    amount: string,
    asset: string = 'usdc'
  ) => {
    if (!signerRef.current || !wsRef.current || !state.isAuthenticated) {
      throw new Error('Not connected or not authenticated')
    }

    setIsSending(true)
    setState(prev => ({ ...prev, error: null }))

    try {
      const transferMsg = await createTransferMessage(signerRef.current, {
        destination: recipientAddress,
        allocations: [{ asset, amount }],
      })

      const response = await sendMessage(transferMsg)
      const result = parseTransferResponse(response)

      // Refresh balances after successful transfer
      await fetchBalances()

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transfer failed'
      setState(prev => ({ ...prev, error: message }))
      throw error
    } finally {
      setIsSending(false)
    }
  }, [state.isAuthenticated, sendMessage, fetchBalances])

  // Get USDC balance
  const getUSDCBalance = useCallback(() => {
    const usdcBalance = state.balances.find(
      b => b.asset.toLowerCase() === 'usdc'
    )
    return usdcBalance?.amount || '0.00'
  }, [state.balances])

  // Disconnect
  const disconnect = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    signerRef.current = null
    setState(initialState)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

  // Handle incoming messages (for real-time updates)
  useEffect(() => {
    if (!wsRef.current) return

    const handleMessage = (event: MessageEvent) => {
      try {
        const response = parseAnyRPCResponse(event.data)

        // Handle balance updates
        if (response.method === 'bu') {
          fetchBalances()
        }
      } catch {
        // Ignore parse errors for non-RPC messages
      }
    }

    wsRef.current.addEventListener('message', handleMessage)

    return () => {
      wsRef.current?.removeEventListener('message', handleMessage)
    }
  }, [fetchBalances])

  return {
    // State
    isConnected: state.isConnected,
    isAuthenticated: state.isAuthenticated,
    balance: getUSDCBalance(),
    error: state.error,

    // Loading states
    isConnecting,
    isSending,

    // Actions
    connect,
    sendPayment,
    fetchBalances,
    disconnect,
  }
}
