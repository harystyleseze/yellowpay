'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Address } from 'viem'
import {
  createAuthRequestMessage,
  createAuthVerifyMessage,
  createGetLedgerBalancesMessage,
  createTransferMessage,
  createEIP712AuthMessageSigner,
  createECDSAMessageSigner,
  parseAuthChallengeResponse,
  parseAuthVerifyResponse,
  parseGetLedgerBalancesResponse,
  parseTransferResponse,
  parseAnyRPCResponse,
  type MessageSigner,
  type RPCBalance,
  type PartialEIP712AuthMessage,
  type EIP712AuthDomain,
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

// Application name - used in both auth_request and EIP-712 domain (must match!)
const APPLICATION_NAME = 'yellowpay'

export function useYellow() {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()

  const [state, setState] = useState<YellowState>(initialState)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isSending, setIsSending] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const signerRef = useRef<MessageSigner | null>(null)

  // Send message and wait for matching response (by request ID)
  const sendMessage = useCallback((message: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'))
        return
      }

      // Extract request ID from the outgoing message to match response
      // nitrolite request format: { req: [requestId, method, params, timestamp], sig?: [...] }
      let requestId: number | null = null
      try {
        const parsed = JSON.parse(message)
        if (parsed.req && Array.isArray(parsed.req) && parsed.req.length > 0) {
          requestId = parsed.req[0]
        }
      } catch {
        // If we can't parse, fall back to accepting any response
      }

      const handleMessage = (event: MessageEvent) => {
        try {
          const data = event.data
          const parsed = JSON.parse(data)

          // nitrolite response format: { res: [requestId, method, params, timestamp], sig?: [...] }
          if (parsed.res && Array.isArray(parsed.res)) {
            const responseId = parsed.res[0]

            // Skip broadcast messages (different request ID than ours)
            // Broadcasts like 'assets', 'bu' are server-initiated with their own IDs
            if (requestId !== null && responseId !== requestId) {
              return // Not our response, keep listening
            }
          }

          // This is our response (matching ID)
          wsRef.current?.removeEventListener('message', handleMessage)
          resolve(data)
        } catch {
          // If parsing fails, accept the message anyway
          wsRef.current?.removeEventListener('message', handleMessage)
          resolve(event.data)
        }
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
  // Follows: https://docs.yellow.org/docs/protocol/off-chain/authentication/
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
        ws.onerror = () => reject(new Error('WebSocket connection failed'))
        ws.onclose = () => {
          setState(prev => ({
            ...prev,
            isConnected: false,
            isAuthenticated: false,
          }))
        }
      })

      setState(prev => ({ ...prev, isConnected: true }))

      // Step 0: Generate session keypair locally (per official docs)
      // "session_key: Wallet address of the locally-generated session keypair"
      const sessionPrivateKey = generatePrivateKey()
      const sessionAccount = privateKeyToAccount(sessionPrivateKey)
      const sessionKeyAddress = sessionAccount.address

      // Auth parameters per official docs:
      // https://docs.yellow.org/docs/protocol/off-chain/authentication/
      // Note: expires_at as Unix timestamp - using seconds (10-digit) as server JWT uses seconds
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 86400) // 24h from now in seconds
      const allowances: { asset: string; amount: string }[] = [] // Empty = unrestricted
      const scope = 'console'

      // Step 1: auth_request (public endpoint, no signature required)
      const authRequestMsg = await createAuthRequestMessage({
        address: address as Address,
        session_key: sessionKeyAddress,
        application: APPLICATION_NAME,
        allowances,
        expires_at: expiresAt,
        scope,
      })

      const challengeResponse = await sendMessage(authRequestMsg)
      const challenge = parseAuthChallengeResponse(challengeResponse)

      // Step 2: Create EIP-712 signer for auth verification
      // "EIP-712 domain name MUST match the application parameter from auth_request"
      const eip712Domain: EIP712AuthDomain = {
        name: APPLICATION_NAME,
      }

      // PartialEIP712AuthMessage fields must match what was sent in auth_request
      const partialMessage: PartialEIP712AuthMessage = {
        scope,
        session_key: sessionKeyAddress,
        expires_at: expiresAt,
        allowances,
      }

      // "The auth_verify signature MUST be an EIP-712 signature signed by the main wallet"
      const authSigner = createEIP712AuthMessageSigner(
        walletClient,
        partialMessage,
        eip712Domain
      )

      // Step 3: auth_verify (EIP-712 signature by main wallet)
      const authVerifyMsg = await createAuthVerifyMessage(
        authSigner,
        challenge,
      )

      const verifyResponse = await sendMessage(authVerifyMsg)

      // Check if response is an error before parsing as auth_verify
      const parsedResponse = parseAnyRPCResponse(verifyResponse)
      if (parsedResponse.method === 'error') {
        const errorParams = parsedResponse.params as { error?: string }
        const errorMsg = errorParams.error || 'Unknown authentication error'
        console.error('Yellow Network auth error:', errorMsg)
        throw new Error(`Authentication error: ${errorMsg}`)
      }

      const verifyResult = parseAuthVerifyResponse(verifyResponse)

      if (verifyResult.params?.success && verifyResult.params?.jwtToken) {
        // "All subsequent private method calls should be signed with the session key"
        // Use SDK's createECDSAMessageSigner which signs with raw ECDSA (keccak256 hash)
        // NOT signMessage which adds EIP-191 prefix
        signerRef.current = createECDSAMessageSigner(sessionPrivateKey)

        setState(prev => ({ ...prev, isAuthenticated: true }))

        // Fetch initial balances
        await fetchBalances()
      } else {
        throw new Error('Authentication failed - verification unsuccessful')
      }
    } catch (error) {
      // Convert technical errors to user-friendly messages
      const technicalMessage = error instanceof Error ? error.message : 'Connection failed'
      let userMessage = 'Unable to connect. Please try again.'

      if (technicalMessage.includes('WebSocket')) {
        userMessage = 'Network connection failed. Please check your internet and try again.'
      } else if (technicalMessage.includes('timeout')) {
        userMessage = 'Connection timed out. Please try again.'
      } else if (technicalMessage.includes('rejected') || technicalMessage.includes('denied')) {
        userMessage = 'Signature request was declined.'
      } else if (technicalMessage.includes('Authentication error')) {
        userMessage = technicalMessage // Show server errors as-is for debugging
      }

      console.error('Yellow Network connection error:', technicalMessage)
      setState(prev => ({ ...prev, error: userMessage }))
      wsRef.current?.close()
      wsRef.current = null
    } finally {
      setIsConnecting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, walletClient, sendMessage])

  // Fetch balances
  const fetchBalances = useCallback(async () => {
    if (!signerRef.current || !wsRef.current) return

    try {
      const balanceMsg = await createGetLedgerBalancesMessage(signerRef.current)
      const response = await sendMessage(balanceMsg)
      const balancesResponse = parseGetLedgerBalancesResponse(response)

      setState(prev => ({
        ...prev,
        balances: balancesResponse.params?.ledgerBalances || [],
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

      // Check if response is an error
      const parsed = parseAnyRPCResponse(response)
      if (parsed.method === 'error') {
        const errorParams = parsed.params as { error?: string }
        throw new Error(errorParams.error || 'Transfer failed')
      }

      const result = parseTransferResponse(response)

      // Refresh balances after successful transfer
      await fetchBalances()

      return result
    } catch (error) {
      const technicalMessage = error instanceof Error ? error.message : 'Transfer failed'
      let userMessage = 'Payment failed. Please try again.'

      if (technicalMessage.includes('insufficient') || technicalMessage.includes('balance')) {
        userMessage = 'Insufficient balance for this payment.'
      } else if (technicalMessage.includes('rejected') || technicalMessage.includes('denied')) {
        userMessage = 'Transaction was declined.'
      } else if (technicalMessage.includes('timeout')) {
        userMessage = 'Request timed out. Please try again.'
      }

      console.error('Payment error:', technicalMessage)
      setState(prev => ({ ...prev, error: userMessage }))
      throw new Error(userMessage)
    } finally {
      setIsSending(false)
    }
  }, [state.isAuthenticated, sendMessage, fetchBalances])

  // Get USDC balance - format to 2 decimal places
  const getUSDCBalance = useCallback(() => {
    const usdcBalance = state.balances.find(
      b => b.asset.toLowerCase() === 'usdc'
    )
    if (!usdcBalance?.amount) return '0.00'

    const amount = parseFloat(usdcBalance.amount)
    return isNaN(amount) ? '0.00' : amount.toFixed(2)
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
