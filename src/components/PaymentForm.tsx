'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useAccount, useWalletClient, useBalance } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import type { Address } from 'viem'
import { ENSInput } from './ENSInput'
import { useYellow } from '@/hooks/useYellow'
import { useENSProfile } from '@/hooks/useENS'
import { useLiFiQuote, useLiFiChains, useLiFiTokens, useTransactionStatus } from '@/hooks/useLiFi'
import { DEFAULT_ASSET, getAssetLabel, getSettlementToken } from '@/lib/constants'
import { UnsupportedChainBanner } from './UnsupportedChainBanner'
import { RequestPayment } from './RequestPayment'
import { addTx, updateTx } from '@/lib/txHistory'
import type { PaymentPrefill } from '@/app/page'
import type { LiFiToken } from '@/lib/lifi'

// Debounce hook
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

type PayMode = 'balance' | 'wallet'
type FormMode = 'send' | 'request'
type WalletPayStep = 'idle' | 'swap' | 'deposit' | 'transfer' | 'done'

interface PaymentFormProps {
  prefill?: PaymentPrefill | null
  onPrefillConsumed?: () => void
}

export function PaymentForm({ prefill, onPrefillConsumed }: PaymentFormProps) {
  const { address: walletAddress, isConnected: walletConnected, chain: currentChain } = useAccount()
  const { data: walletClient } = useWalletClient()
  const senderProfile = useENSProfile(walletAddress)
  const [senderAvatarOk, setSenderAvatarOk] = useState(false)

  useEffect(() => {
    setSenderAvatarOk(false)
  }, [senderProfile.avatar])

  const {
    isConnected,
    isAuthenticated,
    balance,
    balances,
    error,
    isConnecting,
    isSending,
    connect,
    sendPayment,
    disconnect,
    fetchBalances,
    depositToYellow,
  } = useYellow()

  // Shared state
  const [recipient, setRecipient] = useState('')
  const [resolvedRecipient, setResolvedRecipient] = useState<Address | null>(null)
  const [amount, setAmount] = useState('')
  const [selectedAsset, setSelectedAsset] = useState(DEFAULT_ASSET)
  const [txStatus, setTxStatus] = useState<'idle' | 'success' | 'error'>('idle')

  // Send / Request mode toggle
  const [formMode, setFormMode] = useState<FormMode>('send')

  // Payment mode toggle
  const [payMode, setPayMode] = useState<PayMode>('balance')

  // Consume prefill from URL params
  useEffect(() => {
    if (!prefill) return
    if (prefill.to) setRecipient(prefill.to)
    if (prefill.amount) setAmount(prefill.amount)
    if (prefill.asset) setSelectedAsset(prefill.asset)
    onPrefillConsumed?.()
  }, [prefill, onPrefillConsumed])

  // ─── Wallet mode state ───
  const { chains, isLoading: chainsLoading, supportedChainIds } = useLiFiChains()
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null)

  // Set initial chain — prefer wallet chain if supported, otherwise first supported chain
  useEffect(() => {
    if (selectedChainId || chains.length === 0) return
    if (currentChain && supportedChainIds.has(currentChain.id)) {
      setSelectedChainId(currentChain.id)
    } else if (chains.length > 0) {
      setSelectedChainId(chains[0]!.id)
    }
  }, [currentChain, selectedChainId, chains, supportedChainIds])

  const chainIds = useMemo(
    () => selectedChainId ? [selectedChainId] : [],
    [selectedChainId]
  )
  const { tokens: tokenMap, isLoading: tokensLoading, error: tokensError } = useLiFiTokens(chainIds, supportedChainIds)
  const availableTokens = useMemo(
    () => selectedChainId ? (tokenMap[selectedChainId] || []) : [],
    [selectedChainId, tokenMap]
  )

  const [selectedToken, setSelectedToken] = useState<LiFiToken | null>(null)
  const [sourceAmount, setSourceAmount] = useState('')

  // Reset token when chain changes
  useEffect(() => {
    setSelectedToken(null)
    setSourceAmount('')
  }, [selectedChainId])

  // Auto-select native token
  useEffect(() => {
    if (availableTokens.length > 0 && !selectedToken) {
      const native = availableTokens.find(
        t => t.address === '0x0000000000000000000000000000000000000000'
      )
      setSelectedToken(native || availableTokens[0] || null)
    }
  }, [availableTokens, selectedToken])

  // Wallet balance for selected source token
  const walletBalance = useBalance({
    address: walletAddress,
    token: selectedToken?.address === '0x0000000000000000000000000000000000000000'
      ? undefined
      : selectedToken?.address as `0x${string}`,
    chainId: selectedChainId ?? undefined,
    query: { enabled: payMode === 'wallet' && !!selectedToken },
  })

  const formattedWalletBalance = walletBalance.data
    ? parseFloat(formatUnits(walletBalance.data.value, walletBalance.data.decimals)).toFixed(4)
    : '0.00'

  // LI.FI quote for wallet mode
  const debouncedSourceAmount = useDebounce(sourceAmount, 500)
  const { quote, isLoading: quoteLoading, error: quoteError, fetchQuote, clearQuote } = useLiFiQuote()

  // Fetch LI.FI quote when wallet mode inputs change
  useEffect(() => {
    if (payMode !== 'wallet') return
    if (!selectedToken || !selectedChainId || !walletAddress || !debouncedSourceAmount) {
      clearQuote()
      return
    }

    const amountNum = parseFloat(debouncedSourceAmount)
    if (isNaN(amountNum) || amountNum <= 0) {
      clearQuote()
      return
    }

    const fromAmount = parseUnits(debouncedSourceAmount, selectedToken.decimals).toString()
    const settlement = getSettlementToken(selectedAsset)

    fetchQuote({
      fromChain: selectedChainId,
      toChain: settlement.chainId,
      fromToken: selectedToken.address,
      toToken: settlement.tokenAddress,
      fromAmount,
      fromAddress: walletAddress,
    })
  }, [payMode, selectedToken, selectedChainId, walletAddress, debouncedSourceAmount, selectedAsset, clearQuote, fetchQuote])

  // Wallet mode execution state
  const [walletPayStep, setWalletPayStep] = useState<WalletPayStep>('idle')
  const [swapTxHash, setSwapTxHash] = useState<string | null>(null)
  const [walletPayError, setWalletPayError] = useState<string | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const walletTxIdRef = useRef<string | null>(null)

  // Track swap status
  const { status: swapStatus } = useTransactionStatus(
    swapTxHash,
    quote?.action.fromChainId ?? 0,
    quote?.action.toChainId ?? 0,
    quote?.tool,
  )

  // Balance for selected asset
  const selectedBalance = (() => {
    const b = balances.find(
      b => b.asset.toLowerCase() === selectedAsset.toLowerCase()
    )
    if (!b?.amount) return '0.00'
    const num = parseFloat(b.amount)
    return isNaN(num) ? '0.00' : num.toFixed(2)
  })()

  // Delivery amount from LI.FI quote (what the recipient gets)
  const deliveryAmount = quote
    ? formatUnits(BigInt(quote.estimate.toAmount), quote.action.toToken.decimals)
    : null

  // Handle connection
  const handleConnect = async () => {
    setTxStatus('idle')
    await connect()
  }

  // Handle recipient resolution
  const handleResolve = useCallback((address: `0x${string}` | null) => {
    setResolvedRecipient(address)
  }, [])

  // ─── Balance mode: instant send ───
  const handleSendFromBalance = async () => {
    if (!resolvedRecipient || !amount) return
    setTxStatus('idle')
    const tx = addTx({
      type: 'payment',
      status: 'pending',
      asset: selectedAsset,
      amount,
      recipient: recipient || resolvedRecipient,
      recipientAddress: resolvedRecipient,
    })
    try {
      await sendPayment(resolvedRecipient, amount, selectedAsset)
      updateTx(tx.id, { status: 'completed' })
      setTxStatus('success')
      setAmount('')
      setRecipient('')
      setResolvedRecipient(null)
      setTimeout(() => setTxStatus('idle'), 3000)
    } catch (e) {
      console.error('Payment failed:', e)
      updateTx(tx.id, { status: 'failed' })
      setTxStatus('error')
    }
  }

  // ─── Wallet mode: swap → deposit → transfer ───
  const handleSendFromWallet = useCallback(async () => {
    if (!quote || !walletClient || !walletAddress || !resolvedRecipient || !deliveryAmount) return

    setIsExecuting(true)
    setWalletPayError(null)
    setWalletPayStep('swap')

    // Log to tx history
    const chain = chains.find(c => c.id === selectedChainId)
    const tx = addTx({
      type: 'payment',
      status: 'pending',
      asset: selectedAsset,
      amount: deliveryAmount,
      recipient: recipient || resolvedRecipient,
      recipientAddress: resolvedRecipient,
      sourceToken: selectedToken?.symbol,
      sourceAmount: sourceAmount,
      sourceChain: chain?.name,
    })
    walletTxIdRef.current = tx.id

    try {
      // Step 1: Execute LI.FI swap/bridge
      const hash = await walletClient.sendTransaction({
        to: quote.transactionRequest.to as `0x${string}`,
        data: quote.transactionRequest.data as `0x${string}`,
        value: BigInt(quote.transactionRequest.value || '0'),
        gas: BigInt(quote.transactionRequest.gasLimit),
      })
      setSwapTxHash(hash)
      updateTx(tx.id, { txHash: hash })
      // Steps 2 & 3 trigger via effects when swapStatus changes
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transaction failed'
      if (msg.includes('rejected') || msg.includes('denied')) {
        setWalletPayError('Transaction was rejected')
      } else {
        setWalletPayError(msg)
      }
      updateTx(tx.id, { status: 'failed' })
      setWalletPayStep('idle')
    } finally {
      setIsExecuting(false)
    }
  }, [quote, walletClient, walletAddress, resolvedRecipient, deliveryAmount, selectedAsset, sendPayment, fetchBalances, chains, selectedChainId, selectedToken, sourceAmount, recipient])

  // Effect: when LI.FI swap completes → deposit to Yellow Network
  useEffect(() => {
    if (swapStatus?.status !== 'DONE' || walletPayStep !== 'swap') return
    if (!quote || !walletAddress) return

    const doDeposit = async () => {
      setWalletPayStep('deposit')
      try {
        const toToken = quote.action.toToken
        const toAmount = BigInt(quote.estimate.toAmount)
        const toChainId = quote.action.toChainId

        await depositToYellow(
          toToken.address as Address,
          toAmount,
          toChainId,
        )
        // Deposit done → now send the payment
        setWalletPayStep('transfer')
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Deposit to Yellow Network failed'
        setWalletPayError(msg)
        if (walletTxIdRef.current) updateTx(walletTxIdRef.current, { status: 'failed' })
        setWalletPayStep('idle')
      }
    }

    doDeposit()
  }, [swapStatus?.status, walletPayStep, quote, walletAddress, depositToYellow])

  // Effect: when deposit completes → send payment to recipient
  useEffect(() => {
    if (walletPayStep !== 'transfer') return
    if (!resolvedRecipient || !deliveryAmount) return

    const doTransfer = async () => {
      try {
        await sendPayment(resolvedRecipient, deliveryAmount, selectedAsset)
        setWalletPayStep('done')
        if (walletTxIdRef.current) updateTx(walletTxIdRef.current, { status: 'completed' })
        fetchBalances()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Payment transfer failed'
        setWalletPayError(msg)
        if (walletTxIdRef.current) updateTx(walletTxIdRef.current, { status: 'failed' })
        setWalletPayStep('idle')
      }
    }

    doTransfer()
  }, [walletPayStep, resolvedRecipient, deliveryAmount, selectedAsset, sendPayment, fetchBalances])

  // Reset wallet mode for a new payment
  const handleWalletReset = () => {
    setSwapTxHash(null)
    setWalletPayError(null)
    setWalletPayStep('idle')
    setSourceAmount('')
    clearQuote()
    setRecipient('')
    setResolvedRecipient(null)
  }

  // --- Validation ---
  const isValidBalanceAmount = amount && parseFloat(amount) > 0 && parseFloat(amount) <= parseFloat(selectedBalance)
  const isValidWalletAmount = sourceAmount && parseFloat(sourceAmount) > 0 && parseFloat(sourceAmount) <= parseFloat(formattedWalletBalance)
  const nonZeroBalances = balances.filter(b => parseFloat(b.amount) > 0)

  // --- Render: not wallet connected ---
  if (!walletConnected) {
    return (
      <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
        <p className="text-gray-400 text-center">
          Connect your wallet to start sending payments
        </p>
      </div>
    )
  }

  // --- Render: not connected to Yellow Network ---
  if (!isConnected || !isAuthenticated) {
    return (
      <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-4">
        <div className="text-center">
          <h3 className="text-lg font-medium text-white mb-2">
            Connect to Yellow Network
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Enable instant, gasless payments
          </p>
        </div>

        <button
          onClick={handleConnect}
          disabled={isConnecting}
          className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 disabled:bg-yellow-600
                     disabled:cursor-wait text-black font-medium rounded-lg transition-colors
                     flex items-center justify-center gap-2"
        >
          {isConnecting ? (
            <>
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              {isConnected ? 'Authenticating...' : 'Connecting...'}
            </>
          ) : (
            'Connect to Yellow'
          )}
        </button>

        {error && (
          <p className="text-sm text-red-400 text-center">{error}</p>
        )}
      </div>
    )
  }

  // --- Render: wallet mode transaction in progress ---
  if (swapTxHash && payMode === 'wallet') {
    return (
      <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-4">
        <h3 className="text-lg font-medium text-white">
          {walletPayStep === 'done' ? 'Payment Complete' : 'Payment in Progress'}
        </h3>

        <div className="space-y-3">
          <StatusStep label="Swapping tokens" status={
            walletPayStep === 'swap' ? 'active' : walletPayStep !== 'idle' ? 'done' : 'pending'
          } />
          <StatusStep label="Depositing to Yellow Network" status={
            walletPayStep === 'deposit' ? 'active'
            : walletPayStep === 'transfer' || walletPayStep === 'done' ? 'done'
            : 'pending'
          } />
          <StatusStep label="Sending to recipient" status={
            walletPayStep === 'transfer' ? 'active'
            : walletPayStep === 'done' ? 'done'
            : 'pending'
          } />
          <StatusStep label="Payment delivered" status={
            walletPayStep === 'done' ? 'done' : 'pending'
          } />
        </div>

        {swapStatus?.status === 'FAILED' && (
          <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg">
            <p className="text-sm text-red-400">
              {swapStatus.substatusMessage || 'Swap failed. Funds may be refunded.'}
            </p>
          </div>
        )}

        {walletPayError && (
          <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg">
            <p className="text-sm text-red-400">{walletPayError}</p>
          </div>
        )}

        {walletPayStep === 'done' && (
          <div className="p-3 bg-green-900/20 border border-green-700 rounded-lg">
            <p className="text-sm text-green-400">
              {deliveryAmount} {getAssetLabel(selectedAsset)} sent to {recipient || 'recipient'}
            </p>
          </div>
        )}

        {(walletPayStep === 'done' || swapStatus?.status === 'FAILED' || walletPayError) && (
          <button
            onClick={handleWalletReset}
            className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white
                       font-medium rounded-lg transition-colors"
          >
            Send Another Payment
          </button>
        )}

        <p className="text-xs text-gray-500 text-center">
          {`TX: ${swapTxHash.slice(0, 10)}...${swapTxHash.slice(-8)}`}
        </p>
      </div>
    )
  }

  // --- Render: main payment form ---
  return (
    <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-5">
      {/* Header with balances */}
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm text-gray-400">Your Balances</p>
          {nonZeroBalances.length > 0 ? (
            <div className="space-y-0.5 mt-1">
              {nonZeroBalances.map(b => (
                <p key={b.asset} className="text-sm text-white">
                  <span className="font-bold text-lg">
                    {parseFloat(b.amount).toFixed(2)}
                  </span>{' '}
                  <span className="text-gray-400">{getAssetLabel(b.asset)}</span>
                </p>
              ))}
            </div>
          ) : (
            <p className="text-2xl font-bold text-white">{balance} {getAssetLabel(DEFAULT_ASSET)}</p>
          )}
        </div>
        <button
          onClick={disconnect}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Disconnect
        </button>
      </div>

      {/* Sender info */}
      <div className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg">
        <div className="relative w-9 h-9 flex-shrink-0">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-yellow-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold">
            {walletAddress?.slice(2, 4).toUpperCase()}
          </div>
          {senderProfile.avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={senderProfile.avatar}
              alt=""
              className={`absolute inset-0 w-9 h-9 rounded-full object-cover ring-2 ring-gray-700 transition-opacity ${senderAvatarOk ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setSenderAvatarOk(true)}
              onError={() => setSenderAvatarOk(false)}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-500">Sending from</p>
          {senderProfile.name ? (
            <>
              <p className="text-sm text-white font-medium truncate">{senderProfile.name}</p>
              <p className="text-xs text-gray-500 font-mono truncate">
                {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
              </p>
            </>
          ) : (
            <p className="text-sm text-white font-medium font-mono">
              {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
            </p>
          )}
        </div>
      </div>

      {/* Send / Request toggle */}
      <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
        <button
          onClick={() => setFormMode('send')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            formMode === 'send'
              ? 'bg-gray-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Send
        </button>
        <button
          onClick={() => setFormMode('request')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            formMode === 'request'
              ? 'bg-gray-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Request
        </button>
      </div>

      {formMode === 'request' ? (
        <RequestPayment />
      ) : (
      <>
      {/* Payment mode toggle */}
      <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
        <button
          onClick={() => setPayMode('balance')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            payMode === 'balance'
              ? 'bg-gray-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Yellow Balance
        </button>
        <button
          onClick={() => setPayMode('wallet')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            payMode === 'wallet'
              ? 'bg-gray-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Any Token
        </button>
      </div>

      {/* Recipient input (shared) */}
      <ENSInput
        value={recipient}
        onChange={setRecipient}
        onResolve={handleResolve}
      />

      {/* ═══ Balance Mode ═══ */}
      {payMode === 'balance' && (
        <>
          {/* Asset selector + Amount */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">Amount</label>

            {nonZeroBalances.length > 1 && (
              <select
                value={selectedAsset}
                onChange={(e) => { setSelectedAsset(e.target.value); setAmount('') }}
                className="w-full px-4 py-2.5 mb-2 bg-gray-800 border border-gray-700 rounded-lg
                           text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500
                           focus:border-transparent appearance-none cursor-pointer"
              >
                {nonZeroBalances.map(b => (
                  <option key={b.asset} value={b.asset}>
                    {getAssetLabel(b.asset)} — {parseFloat(b.amount).toFixed(2)} available
                  </option>
                ))}
              </select>
            )}

            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg
                           text-white placeholder-gray-500 focus:outline-none focus:ring-2
                           focus:ring-blue-500 focus:border-transparent pr-24"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <span className="text-xs text-gray-500">{getAssetLabel(selectedAsset)}</span>
                <button
                  onClick={() => setAmount(selectedBalance)}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                >
                  MAX
                </button>
              </div>
            </div>

            {amount && parseFloat(amount) > parseFloat(selectedBalance) && (
              <p className="text-sm text-red-400">Insufficient balance</p>
            )}
          </div>

          {/* Send button */}
          <button
            onClick={handleSendFromBalance}
            disabled={!resolvedRecipient || !isValidBalanceAmount || isSending}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700
                       disabled:cursor-not-allowed text-white font-medium rounded-lg
                       transition-colors flex items-center justify-center gap-2"
          >
            {isSending ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Sending...
              </>
            ) : (
              `Send ${getAssetLabel(selectedAsset)} Instantly`
            )}
          </button>
        </>
      )}

      {/* ═══ Wallet (Any Token) Mode ═══ */}
      {payMode === 'wallet' && (
        <>
          {/* Delivery asset selector */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">Recipient Gets</label>
            <select
              value={selectedAsset}
              onChange={(e) => { setSelectedAsset(e.target.value); setSourceAmount('') }}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg
                         text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500
                         focus:border-transparent appearance-none cursor-pointer"
            >
              <option value="usdc">USDC</option>
              <option value="usdt">USDT</option>
              <option value="eth">ETH</option>
            </select>
          </div>

          {/* Source chain selector */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">Pay From Chain</label>
            <select
              value={selectedChainId ?? ''}
              onChange={(e) => setSelectedChainId(Number(e.target.value))}
              disabled={chainsLoading}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg
                         text-white focus:outline-none focus:ring-2 focus:ring-yellow-500
                         focus:border-transparent appearance-none cursor-pointer"
            >
              {chainsLoading ? (
                <option>Loading chains...</option>
              ) : (
                chains.map(chain => (
                  <option key={chain.id} value={chain.id}>{chain.name}</option>
                ))
              )}
            </select>
          </div>

          {/* Unsupported chain warning */}
          {tokensError && (
            <UnsupportedChainBanner message={tokensError} supportedChainIds={supportedChainIds} />
          )}

          {/* Source token selector */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">Pay With Token</label>
            <select
              value={selectedToken?.address ?? ''}
              onChange={(e) => {
                const token = availableTokens.find(t => t.address === e.target.value)
                setSelectedToken(token || null)
                setSourceAmount('')
              }}
              disabled={tokensLoading || availableTokens.length === 0}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg
                         text-white focus:outline-none focus:ring-2 focus:ring-yellow-500
                         focus:border-transparent appearance-none cursor-pointer"
            >
              {tokensLoading ? (
                <option>Loading tokens...</option>
              ) : availableTokens.length === 0 ? (
                <option>No tokens available</option>
              ) : (
                availableTokens.map(token => (
                  <option key={token.address} value={token.address}>
                    {token.symbol} — {token.name}
                  </option>
                ))
              )}
            </select>
            {selectedToken && (
              <p className="text-xs text-gray-500">
                Wallet: {formattedWalletBalance} {selectedToken.symbol}
                {selectedToken.priceUSD && ` (~$${(parseFloat(formattedWalletBalance) * parseFloat(selectedToken.priceUSD)).toFixed(2)})`}
              </p>
            )}
          </div>

          {/* Source amount input */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">You Pay</label>
            <div className="relative">
              <input
                type="number"
                value={sourceAmount}
                onChange={(e) => setSourceAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="any"
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg
                           text-white placeholder-gray-500 focus:outline-none focus:ring-2
                           focus:ring-yellow-500 focus:border-transparent pr-20"
              />
              <button
                onClick={() => setSourceAmount(formattedWalletBalance)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs
                           text-yellow-400 hover:text-yellow-300 font-medium"
              >
                MAX
              </button>
            </div>
            {sourceAmount && parseFloat(sourceAmount) > parseFloat(formattedWalletBalance) && (
              <p className="text-sm text-red-400">Insufficient wallet balance</p>
            )}
          </div>

          {/* LI.FI Quote Preview */}
          {quoteLoading && sourceAmount && (
            <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700/50">
              <div className="flex items-center gap-2 text-gray-400">
                <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Finding best route...</span>
              </div>
            </div>
          )}

          {quote && !quoteLoading && (
            <div className="p-4 bg-gray-800/50 rounded-lg border border-yellow-700/30 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">Recipient gets</span>
                <span className="text-lg font-semibold text-white">
                  {deliveryAmount}{' '}
                  <span className="text-sm text-gray-400">{getAssetLabel(selectedAsset)}</span>
                </span>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-gray-700/50">
                <QuoteDetail
                  label="Route"
                  value={`${quote.toolDetails.name} (${quote.type === 'cross' ? 'bridge' : 'swap'})`}
                />
                <QuoteDetail
                  label="Estimated time"
                  value={quote.estimate.executionDuration < 60
                    ? `~${quote.estimate.executionDuration}s`
                    : `~${Math.ceil(quote.estimate.executionDuration / 60)} min`
                  }
                />
                {quote.estimate.gasCosts[0] && (
                  <QuoteDetail
                    label="Gas cost"
                    value={`~$${quote.estimate.gasCosts[0].amountUSD}`}
                  />
                )}
                {quote.estimate.feeCosts[0] && (
                  <QuoteDetail
                    label="Fee"
                    value={`~$${quote.estimate.feeCosts[0].amountUSD}`}
                  />
                )}
              </div>
            </div>
          )}

          {quoteError && (
            <div className="p-3 bg-red-900/20 border border-red-700/50 rounded-lg">
              <p className="text-sm text-red-400">
                {quoteError.includes('No quote')
                  ? 'No route found. Try a different amount or token.'
                  : quoteError}
              </p>
            </div>
          )}

          {walletPayError && (
            <div className="p-3 bg-red-900/20 border border-red-700/50 rounded-lg">
              <p className="text-sm text-red-400">{walletPayError}</p>
            </div>
          )}

          {/* Send button */}
          <button
            onClick={handleSendFromWallet}
            disabled={!resolvedRecipient || !quote || !isValidWalletAmount || isExecuting || quoteLoading}
            className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700
                       disabled:cursor-not-allowed text-black disabled:text-gray-400
                       font-medium rounded-lg transition-colors
                       flex items-center justify-center gap-2"
          >
            {isExecuting ? (
              <>
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                Confirming...
              </>
            ) : quote && deliveryAmount ? (
              `Pay ${parseFloat(deliveryAmount).toFixed(2)} ${getAssetLabel(selectedAsset)} to Recipient`
            ) : sourceAmount ? (
              'Getting quote...'
            ) : (
              'Enter amount'
            )}
          </button>
        </>
      )}

      {/* Transaction status (balance mode) */}
      {txStatus === 'success' && (
        <div className="p-3 bg-green-900/20 border border-green-700 rounded-lg">
          <p className="text-sm text-green-400 text-center">
            Payment sent successfully!
          </p>
        </div>
      )}

      {txStatus === 'error' && (
        <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg">
          <p className="text-sm text-red-400 text-center">
            {error || 'Payment failed. Please try again.'}
          </p>
        </div>
      )}

      {/* Info text */}
      <p className="text-xs text-gray-500 text-center">
        {payMode === 'balance'
          ? 'Powered by Yellow Network \u00b7 No gas fees \u00b7 Instant confirmation'
          : 'Powered by LI.FI + Yellow Network \u00b7 Pay with any token from any chain'}
      </p>
      </>
      )}
    </div>
  )
}

// --- Sub-components ---

function QuoteDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs text-gray-300">{value}</span>
    </div>
  )
}

function StatusStep({ label, status }: { label: string; status: 'pending' | 'active' | 'done' }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-shrink-0">
        {status === 'done' && (
          <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        {status === 'active' && (
          <div className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center">
            <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {status === 'pending' && (
          <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-gray-500" />
          </div>
        )}
      </div>
      <span className={`text-sm ${
        status === 'done' ? 'text-green-400' :
        status === 'active' ? 'text-yellow-400' :
        'text-gray-500'
      }`}>
        {label}
      </span>
    </div>
  )
}
