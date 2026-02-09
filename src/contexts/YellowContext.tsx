'use client'

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { useAccount, useWalletClient, usePublicClient, useConfig } from 'wagmi'
import { getPublicClient, getWalletClient } from '@wagmi/core'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { type Address, type Hex } from 'viem'

import {
  createAuthRequestMessage,
  createAuthVerifyMessage,
  createGetLedgerBalancesMessage,
  createGetConfigMessage,
  createTransferMessage,
  createGetChannelsMessage,
  createResizeChannelMessage,
  createCloseChannelMessage,
  createCreateChannelMessage,
  createEIP712AuthMessageSigner,
  createECDSAMessageSigner,
  parseAuthChallengeResponse,
  parseAuthVerifyResponse,
  parseGetLedgerBalancesResponse,
  parseTransferResponse,
  parseGetChannelsResponse,
  parseCreateChannelResponse,
  parseResizeChannelResponse,
  parseCloseChannelResponse,
  parseGetConfigResponse,
  parseAnyRPCResponse,
  NitroliteClient,
  WalletStateSigner,
  CustodyAbi,
  getChannelId,
  getPackedState,
  convertRPCToClientChannel,
  type MessageSigner,
  type RPCBalance,
  type RPCChannelUpdateWithWallet,
  type PartialEIP712AuthMessage,
  type EIP712AuthDomain,
  type StateIntent,
  type Allocation,
  type FinalState,
  type State,
} from '@erc7824/nitrolite'

import { YELLOW_WS_ENDPOINT, DEFAULT_ASSET, getContractsForChain, getSettlementToken } from '@/lib/constants'

// Session state interface
interface YellowState {
  isConnected: boolean
  isAuthenticated: boolean
  balances: RPCBalance[]
  channels: RPCChannelUpdateWithWallet[]
  custodyBalance: string // On-chain custody balance (funds deposited but not yet in ledger)
  error: string | null
}

// Initial state
const initialState: YellowState = {
  isConnected: false,
  isAuthenticated: false,
  balances: [],
  channels: [],
  custodyBalance: '0',
  error: null,
}

// Application name - used in both auth_request and EIP-712 domain (must match!)
const APPLICATION_NAME = 'yellowpay'

// Context value type — matches the original useYellow() return type
interface YellowContextValue {
  // State
  isConnected: boolean
  isAuthenticated: boolean
  balance: string
  balances: RPCBalance[]
  channels: RPCChannelUpdateWithWallet[]
  custodyBalance: string // Formatted custody balance (e.g. "0.95")
  error: string | null

  // Loading states
  isConnecting: boolean
  isSending: boolean

  // Actions
  connect: () => Promise<void>
  sendPayment: (recipientAddress: Address, amount: string, asset?: string) => Promise<ReturnType<typeof parseTransferResponse>>
  depositToYellow: (tokenAddress: Address, amount: bigint, chainId: number) => Promise<{ txHash: `0x${string}`; channelId: string | undefined }>
  withdrawFromChannel: (channelId: `0x${string}`, fundsDestination: Address, amount?: bigint) => Promise<void>
  recoverCustodyFunds: () => Promise<void>
  fetchBalances: () => Promise<RPCBalance[]>
  fetchChannels: () => Promise<void>
  disconnect: () => void
}

const YellowContext = createContext<YellowContextValue | null>(null)

export function YellowProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const wagmiConfig = useConfig()

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

          // Only accept properly-structured RPC responses
          // Messages without res field (heartbeats, protocol msgs) must be skipped
          if (!parsed.res || !Array.isArray(parsed.res)) {
            return // Not an RPC response — skip, keep listening
          }

          const responseId = parsed.res[0]

          // Skip broadcast messages (different request ID than ours)
          // Broadcasts like 'assets', 'bu' are server-initiated with their own IDs
          if (requestId !== null && responseId !== requestId) {
            return // Not our response, keep listening
          }

          // This is our response (matching ID and proper RPC format)
          wsRef.current?.removeEventListener('message', handleMessage)
          resolve(data)
        } catch {
          // Parse failed — not a valid RPC message, skip
          return
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
      // Session key must explicitly list permitted assets and spending caps.
      // Empty array = zero spending allowed (NOT unrestricted).
      const allowances = [{ asset: DEFAULT_ASSET, amount: '1000000000' }]
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

        // Fetch initial balances, channels, and check for stranded custody funds
        await Promise.all([fetchBalances(), fetchChannels()])
        // Non-blocking: check on-chain custody balance for recovery UI
        checkCustodyBalance().catch(() => {})
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

  // Fetch balances — returns the fetched balances so callers can inspect them
  // without relying on stale React state closures
  const fetchBalances = useCallback(async (): Promise<RPCBalance[]> => {
    if (!signerRef.current || !wsRef.current) return []

    try {
      const balanceMsg = await createGetLedgerBalancesMessage(signerRef.current)
      const response = await sendMessage(balanceMsg)
      console.log('[Yellow] Raw balance response:', response)

      let balances: RPCBalance[] = []

      try {
        const balancesResponse = parseGetLedgerBalancesResponse(response)
        balances = balancesResponse.params?.ledgerBalances || []
      } catch (parseError) {
        console.warn('[Yellow] Standard balance parse failed, trying fallback:', parseError)
        // Fallback: manually extract from raw response
        try {
          const raw = JSON.parse(response)
          const params = raw.res?.[2]
          if (params) {
            const arr = params.ledger_balances || params.ledgerBalances
                     || params.balances || (Array.isArray(params) ? params : null)
            if (Array.isArray(arr)) {
              balances = arr
                .filter((b: unknown) => b != null && typeof b === 'object' && 'amount' in (b as Record<string, unknown>))
                .map((b: unknown) => {
                  const entry = b as Record<string, unknown>
                  return {
                    asset: String(entry.asset || entry.token || 'unknown'),
                    amount: String(entry.amount || entry.balance || '0'),
                  }
                })
            }
          }
        } catch { /* manual parse also failed */ }
      }

      console.log('[Yellow] Balances:', balances)
      setState(prev => ({ ...prev, balances }))
      return balances
    } catch (error) {
      console.error('[Yellow] Failed to fetch balances:', error)
      return []
    }
  }, [sendMessage])

  // Fetch channels
  const fetchChannels = useCallback(async () => {
    if (!signerRef.current || !wsRef.current) return

    try {
      const channelsMsg = await createGetChannelsMessage(signerRef.current, address)
      const response = await sendMessage(channelsMsg)
      const channelsResponse = parseGetChannelsResponse(response)

      setState(prev => ({
        ...prev,
        channels: channelsResponse.params?.channels || [],
      }))
    } catch (error) {
      console.error('Failed to fetch channels:', error)
    }
  }, [sendMessage, address])

  // Check on-chain custody balance for the default settlement token
  // Funds here were deposited but never moved to the unified ledger
  const checkCustodyBalance = useCallback(async () => {
    if (!publicClient || !walletClient) return

    try {
      const settlement = getSettlementToken(DEFAULT_ASSET)
      const contracts = getContractsForChain(settlement.chainId)

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const nitroliteClient = new NitroliteClient({
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        addresses: contracts,
        chainId: settlement.chainId,
        challengeDuration: BigInt(3600),
        stateSigner: new WalletStateSigner(walletClient as any),
      })
      /* eslint-enable @typescript-eslint/no-explicit-any */

      const rawBalance = await nitroliteClient.getAccountBalance(
        settlement.tokenAddress as Address
      )
      const formatted = (Number(rawBalance) / 10 ** settlement.decimals).toFixed(2)
      console.log('[Yellow] On-chain custody balance:', formatted, settlement.symbol)
      setState(prev => ({ ...prev, custodyBalance: formatted }))
    } catch (error) {
      console.warn('[Yellow] Could not check custody balance:', error)
    }
  }, [publicClient, walletClient])

  // Recover funds stuck in the custody contract from previous incomplete deposits.
  // For smart accounts (EIP-7702): withdraws directly back to wallet (no signatures needed).
  // For EOAs: creates a channel and moves funds to the Yellow Network unified ledger.
  const recoverCustodyFunds = useCallback(async () => {
    if (!signerRef.current || !wsRef.current || !state.isAuthenticated) {
      throw new Error('Not connected or not authenticated')
    }
    if (!walletClient || !publicClient) {
      throw new Error('Wallet not connected')
    }

    const settlement = getSettlementToken(DEFAULT_ASSET)
    const contracts = getContractsForChain(settlement.chainId)

    setState(prev => ({ ...prev, error: null }))

    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      let recoverPublicClient: any = publicClient
      let recoverWalletClient: any = walletClient

      if (publicClient.chain?.id !== settlement.chainId) {
        try {
          recoverPublicClient = getPublicClient(wagmiConfig, { chainId: settlement.chainId })
          recoverWalletClient = await getWalletClient(wagmiConfig, { chainId: settlement.chainId })
        } catch {
          throw new Error(`Please switch your wallet to chain ${settlement.chainId}.`)
        }
      }

      const nitroliteClient = new NitroliteClient({
        publicClient: recoverPublicClient as any,
        walletClient: recoverWalletClient as any,
        addresses: contracts,
        chainId: settlement.chainId,
        challengeDuration: BigInt(3600),
        stateSigner: new WalletStateSigner(recoverWalletClient as any),
      })
      /* eslint-enable @typescript-eslint/no-explicit-any */

      // Check how much is in custody
      const custodyAmount = await nitroliteClient.getAccountBalance(
        settlement.tokenAddress as Address
      )
      if (custodyAmount <= BigInt(0)) {
        console.log('[Yellow] No funds in custody to recover')
        setState(prev => ({ ...prev, custodyBalance: '0' }))
        return
      }
      console.log('[Yellow] Recovering custody funds:', custodyAmount.toString())

      // Check if wallet has on-chain code (EIP-7702 smart account)
      const walletCode = await recoverPublicClient.getCode({
        address: recoverWalletClient.account.address,
      })
      const isSmartAccount = !!walletCode && walletCode !== '0x'
      console.log('[Yellow] Recovery wallet code:', walletCode?.slice(0, 20) || '(none)')
      console.log('[Yellow] Recovery isSmartAccount:', isSmartAccount)

      if (isSmartAccount) {
        // ── Smart account path: Direct withdrawal ──
        // EIP-7702 DeleGator wallets can't create channels because:
        // - The custody contract's verifyStateSignature takes the ERC-1271 path
        // - The DeleGator's isValidSignature requires raw ECDSA (eth_sign)
        // - MetaMask has removed eth_sign
        // The custody contract's withdraw() function is a simple msg.sender-based
        // call that doesn't need state signatures — it just transfers tokens back.
        console.log('[Yellow] Smart account: Using direct withdrawal (no signatures needed)...')
        console.log('[Yellow] Withdrawing:', custodyAmount.toString(), settlement.symbol)
        await nitroliteClient.withdrawal(
          settlement.tokenAddress as Address,
          custodyAmount,
        )
        console.log('[Yellow] Direct withdrawal complete! Funds returned to wallet.')
        setState(prev => ({ ...prev, custodyBalance: '0' }))
        // Verify custody is now empty
        await checkCustodyBalance().catch(() => {})
        return
      }

      // ── EOA path: Create channel and move funds to Yellow Network ledger ──
      // Try to find an existing open channel on-chain to reuse
      let channelId: string | undefined
      try {
        const openChannels = await nitroliteClient.getOpenChannels()
        console.log('[Yellow] Open channels on-chain:', openChannels?.length ?? 0)
        if (openChannels && openChannels.length > 0) {
          channelId = openChannels[0] as string
          console.log('[Yellow] Reusing existing channel:', channelId)
        }
      } catch (e) {
        console.warn('[Yellow] Could not query open channels:', e)
      }

      // If no existing channel, create a new one
      if (!channelId) {
        console.log('[Yellow] Recovery: No existing channel, creating new one...')
        const createMsg = await createCreateChannelMessage(signerRef.current, {
          chain_id: settlement.chainId,
          token: settlement.tokenAddress as `0x${string}`,
        })
        const createResponse = await sendMessage(createMsg)
        console.log('[Yellow] Recovery raw create_channel response:', createResponse)

        const parsedCreate = parseCreateChannelResponse(createResponse)
        const { channel: recoverChannel, state: recoverState, serverSignature: recoverSig, channelId: recoverServerChId } = parsedCreate.params

        const recoverClientChannel = convertRPCToClientChannel(recoverChannel as Parameters<typeof convertRPCToClientChannel>[0])
        const recoverUnsignedState = {
          intent: recoverState.intent as StateIntent,
          version: BigInt(recoverState.version),
          data: (recoverState.stateData || '0x') as `0x${string}`,
          allocations: recoverState.allocations as Allocation[],
        }

        const localChId = getChannelId(recoverClientChannel, settlement.chainId)
        console.log('[Yellow] Recovery channelIDs match:', recoverServerChId === localChId)

        // EOA: sign the full packedState with EIP-191
        const packedState = getPackedState(localChId, recoverUnsignedState) as Hex
        const clientSig = await recoverWalletClient.signMessage({
          message: { raw: packedState },
        })

        const { request: createRequest } = await recoverPublicClient.simulateContract({
          account: recoverWalletClient.account,
          address: contracts.custody as Address,
          abi: CustodyAbi,
          functionName: 'create',
          args: [{
            participants: recoverClientChannel.participants as readonly Address[],
            adjudicator: recoverClientChannel.adjudicator as Address,
            challenge: recoverClientChannel.challenge,
            nonce: recoverClientChannel.nonce,
          }, {
            intent: recoverUnsignedState.intent,
            version: recoverUnsignedState.version,
            data: recoverUnsignedState.data,
            allocations: recoverUnsignedState.allocations.map(a => ({
              destination: a.destination as Address,
              token: a.token as Address,
              amount: a.amount,
            })),
            sigs: [clientSig, recoverSig as `0x${string}`],
          }],
        })
        const createTxHash = await recoverWalletClient.writeContract(createRequest)
        await recoverPublicClient.waitForTransactionReceipt({ hash: createTxHash })
        channelId = localChId
        console.log('[Yellow] Recovery channel confirmed:', channelId)
      }

      // Get broker address
      console.log('[Yellow] Recovery: Getting broker address...')
      const configMsg = await createGetConfigMessage(signerRef.current)
      const configResponse = await sendMessage(configMsg)
      const parsedConfig = parseGetConfigResponse(configResponse)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recoverConfigParams = parsedConfig.params as any
      const brokerAddress = (recoverConfigParams.brokerAddress || recoverConfigParams.broker_address) as `0x${string}`

      // Move custody funds to unified ledger via two-step resize:
      // Step 1: custody → channel (resize_amount)
      // Step 2: channel → ledger (allocate_amount)
      // If resize fails, fall back to direct withdrawal (returns funds to wallet)
      console.log('[Yellow] Recovery: Moving funds to ledger (two-step resize)...')
      try {
        // Step 1: custody → channel
        console.log('[Yellow] Recovery resize step 1: custody → channel...')
        const resizeMsg = await createResizeChannelMessage(signerRef.current, {
          channel_id: channelId as `0x${string}`,
          resize_amount: custodyAmount,
          allocate_amount: BigInt(0),
          funds_destination: brokerAddress,
        })
        const resizeResponse = await sendMessage(resizeMsg)
        console.log('[Yellow] Recovery resize step 1 response:', resizeResponse)

        const resizeParsedAny = parseAnyRPCResponse(resizeResponse)
        if (resizeParsedAny.method === 'error') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errParams = resizeParsedAny.params as any
          throw new Error(`Server rejected resize step 1: ${errParams?.error || JSON.stringify(errParams)}`)
        }

        const parsedResize = parseResizeChannelResponse(resizeResponse)
        const recoverResizeData = parsedResize.params
        const channelData = await nitroliteClient.getChannelData(channelId as `0x${string}`)
        const resizeState: FinalState = {
          channelId: (recoverResizeData.channelId || channelId) as `0x${string}`,
          intent: recoverResizeData.state.intent as StateIntent,
          version: BigInt(recoverResizeData.state.version),
          data: recoverResizeData.state.stateData as `0x${string}`,
          allocations: recoverResizeData.state.allocations as Allocation[],
          serverSignature: recoverResizeData.serverSignature as `0x${string}`,
        }
        await nitroliteClient.resizeChannel({
          resizeState,
          proofStates: [channelData.lastValidState as State],
        })
        console.log('[Yellow] Recovery resize step 1 done (custody → channel)')

        // Step 2: channel → ledger (retry with delay for server to detect on-chain resize)
        console.log('[Yellow] Recovery resize step 2: channel → ledger...')
        let allocateResponse: string = ''
        for (let attempt = 0; attempt < 6; attempt++) {
          if (attempt > 0) {
            const delay = attempt * 3000
            console.log(`[Yellow] Recovery allocate: waiting ${delay / 1000}s (attempt ${attempt + 1}/6)...`)
            await new Promise(r => setTimeout(r, delay))
          }
          const allocateMsg = await createResizeChannelMessage(signerRef.current!, {
            channel_id: channelId as `0x${string}`,
            resize_amount: BigInt(0),
            allocate_amount: custodyAmount,
            funds_destination: brokerAddress,
          })
          allocateResponse = await sendMessage(allocateMsg)
          console.log('[Yellow] Recovery allocate response:', allocateResponse)

          const allocateParsedAny = parseAnyRPCResponse(allocateResponse)
          if (allocateParsedAny.method === 'error') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const allocErrParams = allocateParsedAny.params as any
            const allocServerError = String(allocErrParams?.error || '')
            if (allocServerError.includes('resize already ongoing') && attempt < 5) {
              continue
            }
            throw new Error(`Server rejected allocate: ${allocServerError || JSON.stringify(allocErrParams)}`)
          }
          break
        }

        const parsedAllocate = parseResizeChannelResponse(allocateResponse)
        const allocateData = parsedAllocate.params
        const channelData2 = await nitroliteClient.getChannelData(channelId as `0x${string}`)
        const allocateState: FinalState = {
          channelId: (allocateData.channelId || channelId) as `0x${string}`,
          intent: allocateData.state.intent as StateIntent,
          version: BigInt(allocateData.state.version),
          data: allocateData.state.stateData as `0x${string}`,
          allocations: allocateData.state.allocations as Allocation[],
          serverSignature: allocateData.serverSignature as `0x${string}`,
        }
        await nitroliteClient.resizeChannel({
          resizeState: allocateState,
          proofStates: [channelData2.lastValidState as State],
        })

        console.log('[Yellow] Recovery complete! Funds moved to ledger.')
      } catch (resizeError) {
        // Resize failed — fall back to direct withdrawal (returns funds to wallet)
        console.warn('[Yellow] Recovery resize failed:', resizeError)
        console.log('[Yellow] Recovery: Falling back to direct withdrawal to wallet...')
        await nitroliteClient.withdrawal(
          settlement.tokenAddress as Address,
          custodyAmount,
        )
        console.log('[Yellow] Recovery: Direct withdrawal complete! Funds returned to wallet.')
      }

      setState(prev => ({ ...prev, custodyBalance: '0' }))
      await checkCustodyBalance().catch(() => {})
      await fetchBalances()
      await fetchChannels()
    } catch (error) {
      let msg = error instanceof Error ? error.message : 'Recovery failed'
      let current: unknown = error
      const causes: string[] = []
      while (current && typeof current === 'object' && 'cause' in current) {
        current = (current as { cause: unknown }).cause
        if (current && typeof current === 'object') {
          const c = current as { shortMessage?: string; message?: string }
          if (c.shortMessage) causes.push(c.shortMessage)
          else if (c.message) causes.push(c.message)
        }
      }
      if (causes.length > 0) msg += ' | ' + causes.join(' | ')
      console.error('[Yellow] Recovery error:', msg, error)
      setState(prev => ({ ...prev, error: msg }))
      throw error
    }
  }, [state.isAuthenticated, walletClient, publicClient, wagmiConfig, sendMessage, fetchBalances, fetchChannels, checkCustodyBalance])

  // Withdraw from a channel
  // If amount covers the full channel balance, close the channel.
  // Otherwise, resize (partial withdraw).
  const withdrawFromChannel = useCallback(async (
    channelId: `0x${string}`,
    fundsDestination: Address,
    amount?: bigint, // undefined = full withdrawal (close)
  ) => {
    if (!signerRef.current || !wsRef.current || !state.isAuthenticated) {
      throw new Error('Not connected or not authenticated')
    }

    setState(prev => ({ ...prev, error: null }))

    try {
      let response: string

      if (amount !== undefined) {
        // Partial withdraw via resize
        const resizeMsg = await createResizeChannelMessage(signerRef.current, {
          channel_id: channelId,
          resize_amount: amount,
          funds_destination: fundsDestination,
        })
        response = await sendMessage(resizeMsg)

        const parsed = parseAnyRPCResponse(response)
        if (parsed.method === 'error') {
          const errorParams = parsed.params as { error?: string }
          throw new Error(errorParams.error || 'Resize failed')
        }
        parseResizeChannelResponse(response)
      } else {
        // Full withdraw via close
        const closeMsg = await createCloseChannelMessage(
          signerRef.current,
          channelId,
          fundsDestination,
        )
        response = await sendMessage(closeMsg)

        const parsed = parseAnyRPCResponse(response)
        if (parsed.method === 'error') {
          const errorParams = parsed.params as { error?: string }
          throw new Error(errorParams.error || 'Channel close failed')
        }
        parseCloseChannelResponse(response)
      }

      // Refresh balances and channels
      await Promise.all([fetchBalances(), fetchChannels()])
    } catch (error) {
      const technicalMessage = error instanceof Error ? error.message : 'Withdrawal failed'
      console.error('Withdrawal error:', technicalMessage)
      setState(prev => ({ ...prev, error: technicalMessage }))
      throw error
    }
  }, [state.isAuthenticated, sendMessage, fetchBalances, fetchChannels])

  // Deposit on-chain tokens into Yellow Network
  // Flow: ensure channel exists → deposit to custody → get config → resize (two steps) to unified ledger
  const depositToYellow = useCallback(async (
    tokenAddress: Address,
    amount: bigint,
    chainId: number,
  ) => {
    if (!signerRef.current || !wsRef.current || !state.isAuthenticated) {
      throw new Error('Not connected or not authenticated')
    }
    if (!walletClient || !publicClient) {
      throw new Error('Wallet not connected')
    }

    setState(prev => ({ ...prev, error: null }))

    try {
      const contracts = getContractsForChain(chainId)
      console.log('[Yellow] Deposit:', { chainId, token: tokenAddress, amount: amount.toString(), custody: contracts.custody })

      /* eslint-disable @typescript-eslint/no-explicit-any */
      let depositPublicClient: any = publicClient
      let depositWalletClient: any = walletClient

      if (publicClient.chain?.id !== chainId) {
        console.warn(`[Yellow] Chain mismatch: wallet on ${publicClient.chain?.id}, deposit needs ${chainId}. Getting chain-specific clients.`)
        try {
          depositPublicClient = getPublicClient(wagmiConfig, { chainId })
          depositWalletClient = await getWalletClient(wagmiConfig, { chainId })
        } catch {
          throw new Error(
            `Please switch your wallet to chain ${chainId}. Currently connected to chain ${publicClient.chain?.id ?? 'unknown'}.`
          )
        }
      }

      const nitroliteClient = new NitroliteClient({
        publicClient: depositPublicClient as any,
        walletClient: depositWalletClient as any,
        addresses: contracts,
        chainId,
        challengeDuration: BigInt(3600),
        stateSigner: new WalletStateSigner(depositWalletClient as any),
      })
      /* eslint-enable @typescript-eslint/no-explicit-any */

      // ── Step 1: Ensure a channel exists (reuse existing or create new) ──
      let channelId: string | undefined

      // Check for existing open channel on-chain
      try {
        const openChannels = await nitroliteClient.getOpenChannels()
        if (openChannels && openChannels.length > 0) {
          channelId = openChannels[0] as string
          console.log('[Yellow] Step 1: Reusing existing channel:', channelId)
        }
      } catch (e) {
        console.warn('[Yellow] Could not query open channels:', e)
      }

      // No existing channel — create a new one
      if (!channelId) {
        console.log('[Yellow] Step 1: Creating new channel...')
        const createMsg = await createCreateChannelMessage(signerRef.current, {
          chain_id: chainId,
          token: tokenAddress,
        })
        const createResponse = await sendMessage(createMsg)
        console.log('[Yellow] Raw create_channel response:', createResponse)

        // Check for server error (e.g., channel already exists)
        const createParsedAny = parseAnyRPCResponse(createResponse)
        if (createParsedAny.method === 'error') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errParams = createParsedAny.params as any
          const serverError = errParams?.error || ''
          // Extract channel ID from "already exists: 0x..." error
          const existingMatch = serverError.match(/already exists:\s*(0x[a-fA-F0-9]+)/)
          if (existingMatch) {
            channelId = existingMatch[1]
            console.log('[Yellow] Server says channel exists:', channelId)
          } else {
            throw new Error(`Channel creation failed: ${serverError}`)
          }
        }

        if (!channelId) {
          const parsedCreate = parseCreateChannelResponse(createResponse)
          const { channel: serverChannel, state: createState, serverSignature, channelId: serverChannelId } = parsedCreate.params

          const clientChannel = convertRPCToClientChannel(serverChannel as Parameters<typeof convertRPCToClientChannel>[0])
          const unsignedInitialState = {
            intent: createState.intent as StateIntent,
            version: BigInt(createState.version),
            data: (createState.stateData || '0x') as `0x${string}`,
            allocations: createState.allocations as Allocation[],
          }

          const localChannelId = getChannelId(clientChannel, chainId)
          console.log('[Yellow] ChannelIDs match:', serverChannelId === localChannelId)

          // Check for smart account (EIP-7702)
          const depositWalletCode = await depositPublicClient.getCode({
            address: depositWalletClient.account.address,
          })
          if (depositWalletCode && depositWalletCode !== '0x') {
            throw new Error(
              'Your wallet has an EIP-7702 smart account delegation that prevents channel creation. ' +
              'To deposit, please disable the smart account in MetaMask settings. ' +
              'Your existing funds can be recovered using the Recover button above.'
            )
          }

          // EOA: sign the full packedState with EIP-191
          const depositPackedState = getPackedState(localChannelId, unsignedInitialState) as Hex
          const clientSig = await depositWalletClient.signMessage({
            message: { raw: depositPackedState },
          })
          console.log('[Yellow] Client sig:', (clientSig as string).slice(0, 20) + '...')

          // Execute on-chain channel creation
          console.log('[Yellow] Step 1b: Creating channel on-chain...')
          const { request: createRequest } = await depositPublicClient.simulateContract({
            account: depositWalletClient.account,
            address: contracts.custody as Address,
            abi: CustodyAbi,
            functionName: 'create',
            args: [{
              participants: clientChannel.participants as readonly Address[],
              adjudicator: clientChannel.adjudicator as Address,
              challenge: clientChannel.challenge,
              nonce: clientChannel.nonce,
            }, {
              intent: unsignedInitialState.intent,
              version: unsignedInitialState.version,
              data: unsignedInitialState.data,
              allocations: unsignedInitialState.allocations.map(a => ({
                destination: a.destination as Address,
                token: a.token as Address,
                amount: a.amount,
              })),
              sigs: [clientSig, serverSignature as `0x${string}`],
            }],
          })
          const createTxHash = await depositWalletClient.writeContract(createRequest)
          await depositPublicClient.waitForTransactionReceipt({ hash: createTxHash })
          channelId = localChannelId
          console.log('[Yellow] Channel created on-chain:', channelId)
        }
      }

      // ── Step 2: Approve + Deposit tokens into custody contract on-chain ──
      // Ensure the custody contract has sufficient ERC-20 allowance
      const currentAllowance = await nitroliteClient.getTokenAllowance(tokenAddress)
      if (currentAllowance < amount) {
        console.log('[Yellow] Step 2a: Approving token spend...')
        await nitroliteClient.approveTokens(tokenAddress, amount)
        console.log('[Yellow] Token approved')
      }
      console.log('[Yellow] Step 2b: Depositing to custody contract...')
      const depositTxHash = await nitroliteClient.deposit(tokenAddress, amount)
      console.log('[Yellow] Deposit tx:', depositTxHash)

      // ── Step 3: Get broker address from server config ──
      console.log('[Yellow] Step 3: Getting broker address...')
      const configMsg = await createGetConfigMessage(signerRef.current)
      const configResponse = await sendMessage(configMsg)
      const parsedConfig = parseGetConfigResponse(configResponse)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const configParams = parsedConfig.params as any
      const brokerAddress = (configParams.brokerAddress || configParams.broker_address) as `0x${string}`
      console.log('[Yellow] Broker address:', brokerAddress)

      // ── Step 4: Resize — move funds from custody into the channel ──
      // The server validates allocate_amount against current channel balance,
      // so we must do this in two steps: first custody→channel, then channel→ledger.
      console.log('[Yellow] Step 4: Resizing channel (custody → channel)...')
      const resizeMsg = await createResizeChannelMessage(signerRef.current, {
        channel_id: channelId as `0x${string}`,
        resize_amount: amount,
        allocate_amount: BigInt(0),
        funds_destination: brokerAddress,
      })
      const resizeResponse = await sendMessage(resizeMsg)
      console.log('[Yellow] Resize response:', resizeResponse)

      const resizeParsedAny = parseAnyRPCResponse(resizeResponse)
      if (resizeParsedAny.method === 'error') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errParams = resizeParsedAny.params as any
        const serverError = errParams?.error || errParams?.message || JSON.stringify(errParams)
        throw new Error(`Resize (custody→channel) failed: ${serverError}`)
      }

      const parsedResize = parseResizeChannelResponse(resizeResponse)
      const resizeData = parsedResize.params
      console.log('[Yellow] Resize approved, executing on-chain...')

      const channelData = await nitroliteClient.getChannelData(channelId as `0x${string}`)
      const resizeState: FinalState = {
        channelId: (resizeData.channelId || channelId) as `0x${string}`,
        intent: resizeData.state.intent as StateIntent,
        version: BigInt(resizeData.state.version),
        data: resizeData.state.stateData as `0x${string}`,
        allocations: resizeData.state.allocations as Allocation[],
        serverSignature: resizeData.serverSignature as `0x${string}`,
      }

      const { txHash: resizeTxHash } = await nitroliteClient.resizeChannel({
        resizeState,
        proofStates: [channelData.lastValidState as State],
      })
      console.log('[Yellow] Resize tx:', resizeTxHash)

      // ── Step 5: Allocate — move funds from channel into the unified ledger ──
      // The server needs time to detect the on-chain resize before accepting allocate.
      // Retry with increasing delay until the server is ready.
      console.log('[Yellow] Step 5: Allocating (channel → ledger)...')
      let allocateResponse: string = ''
      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt > 0) {
          const delay = attempt * 3000 // 3s, 6s, 9s, 12s, 15s
          console.log(`[Yellow] Allocate: waiting ${delay / 1000}s for server to process resize (attempt ${attempt + 1}/6)...`)
          await new Promise(r => setTimeout(r, delay))
        }
        const allocateMsg = await createResizeChannelMessage(signerRef.current!, {
          channel_id: channelId as `0x${string}`,
          resize_amount: BigInt(0),
          allocate_amount: amount,
          funds_destination: brokerAddress,
        })
        allocateResponse = await sendMessage(allocateMsg)
        console.log('[Yellow] Allocate response:', allocateResponse)

        const allocateParsedAny = parseAnyRPCResponse(allocateResponse)
        if (allocateParsedAny.method === 'error') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const allocErrParams = allocateParsedAny.params as any
          const allocServerError = String(allocErrParams?.error || '')
          // "resize already ongoing" means server hasn't processed the on-chain tx yet — retry
          if (allocServerError.includes('resize already ongoing') && attempt < 5) {
            continue
          }
          throw new Error(`Allocate (channel→ledger) failed: ${allocServerError || JSON.stringify(allocErrParams)}`)
        }
        break // Success
      }

      const parsedAllocate = parseResizeChannelResponse(allocateResponse)
      const allocateData = parsedAllocate.params
      console.log('[Yellow] Allocate approved, executing on-chain...')

      const channelData2 = await nitroliteClient.getChannelData(channelId as `0x${string}`)
      const allocateState: FinalState = {
        channelId: (allocateData.channelId || channelId) as `0x${string}`,
        intent: allocateData.state.intent as StateIntent,
        version: BigInt(allocateData.state.version),
        data: allocateData.state.stateData as `0x${string}`,
        allocations: allocateData.state.allocations as Allocation[],
        serverSignature: allocateData.serverSignature as `0x${string}`,
      }

      const { txHash: allocateTxHash } = await nitroliteClient.resizeChannel({
        resizeState: allocateState,
        proofStates: [channelData2.lastValidState as State],
      })
      console.log('[Yellow] Allocate tx:', allocateTxHash)

      // ── Done! Fetch balances — should be non-zero now ──
      console.log('[Yellow] Deposit complete! Fetching balances...')
      await fetchBalances()
      await fetchChannels()

      return { txHash: depositTxHash, channelId: channelId as string }
    } catch (error) {
      // Extract the full error chain — NitroliteClient wraps the actual revert reason
      // from viem deep inside error.cause, which is critical for diagnosis
      let technicalMessage = error instanceof Error ? error.message : 'Deposit failed'
      let current: unknown = error
      const causes: string[] = []
      while (current && typeof current === 'object' && 'cause' in current) {
        current = (current as { cause: unknown }).cause
        if (current && typeof current === 'object') {
          const c = current as { shortMessage?: string; message?: string }
          if (c.shortMessage) causes.push(c.shortMessage)
          else if (c.message) causes.push(c.message)
        }
      }
      if (causes.length > 0) technicalMessage += ' | ' + causes.join(' | ')

      console.error('[Yellow] Deposit error:', technicalMessage)
      console.error('[Yellow] Deposit error (full):', error)
      setState(prev => ({ ...prev, error: technicalMessage }))
      throw error
    }
  }, [state.isAuthenticated, walletClient, publicClient, wagmiConfig, sendMessage, fetchBalances, fetchChannels])

  // Send payment
  const sendPayment = useCallback(async (
    recipientAddress: Address,
    amount: string,
    asset: string = DEFAULT_ASSET
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

  // Get default asset balance - format to 2 decimal places
  const getDefaultBalance = useCallback(() => {
    const assetBalance = state.balances.find(
      b => b.asset.toLowerCase() === DEFAULT_ASSET.toLowerCase()
    )
    if (!assetBalance?.amount) return '0.00'

    const amount = parseFloat(assetBalance.amount)
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
          // Use balance data directly from the broadcast
          const updates = (response.params as { balanceUpdates?: RPCBalance[] })?.balanceUpdates
          if (Array.isArray(updates) && updates.length > 0) {
            setState(prev => ({ ...prev, balances: updates }))
          }
          // Also fetch full balances as backup
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

  // Heartbeat: prevent WebSocket idle timeout by periodically fetching balances
  // Most WebSocket servers drop idle connections after 30-120s of inactivity.
  // Sending a valid RPC call every 30s keeps the connection alive and data fresh.
  useEffect(() => {
    if (!state.isAuthenticated) return

    const heartbeat = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN && signerRef.current) {
        fetchBalances()
      }
    }, 30_000)

    return () => clearInterval(heartbeat)
  }, [state.isAuthenticated, fetchBalances])

  const value: YellowContextValue = {
    // State
    isConnected: state.isConnected,
    isAuthenticated: state.isAuthenticated,
    balance: getDefaultBalance(),
    balances: state.balances,
    channels: state.channels,
    custodyBalance: state.custodyBalance,
    error: state.error,

    // Loading states
    isConnecting,
    isSending,

    // Actions
    connect,
    sendPayment,
    depositToYellow,
    withdrawFromChannel,
    recoverCustodyFunds,
    fetchBalances,
    fetchChannels,
    disconnect,
  }

  return (
    <YellowContext.Provider value={value}>
      {children}
    </YellowContext.Provider>
  )
}

export function useYellow() {
  const context = useContext(YellowContext)
  if (!context) {
    throw new Error('useYellow must be used within a YellowProvider')
  }
  return context
}
