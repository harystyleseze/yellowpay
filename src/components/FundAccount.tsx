'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAccount, useWalletClient, usePublicClient, useBalance } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { useLiFiQuote, useLiFiChains, useLiFiTokens, useTransactionStatus } from '@/hooks/useLiFi'
import { useYellow } from '@/hooks/useYellow'
import { DEFAULT_ASSET_LABEL, getSettlementToken, DEFAULT_ASSET } from '@/lib/constants'
import { addTx, updateTx } from '@/lib/txHistory'
import { ensureApproval } from '@/lib/erc20'
import { UnsupportedChainBanner } from './UnsupportedChainBanner'
import type { LiFiToken } from '@/lib/lifi'
import type { Address } from 'viem'

// Debounce hook
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export function FundAccount() {
  const { address, isConnected: walletConnected, chain: currentChain } = useAccount()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const { isConnected: yellowConnected, isAuthenticated, balance: yellowBalance, custodyBalance, fetchBalances, depositToYellow, recoverCustodyFunds, connect, isConnecting, error: yellowError } = useYellow()

  // Chain & token selection
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

  // Fetch tokens for selected chain
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
  const [amount, setAmount] = useState('')

  // Reset token when chain changes
  useEffect(() => {
    setSelectedToken(null)
    setAmount('')
  }, [selectedChainId])

  // Auto-select native token when tokens load
  useEffect(() => {
    if (availableTokens.length > 0 && !selectedToken) {
      // Prefer native token (address = 0x000...0)
      const native = availableTokens.find(
        t => t.address === '0x0000000000000000000000000000000000000000'
      )
      setSelectedToken(native || availableTokens[0] || null)
    }
  }, [availableTokens, selectedToken])

  // Fetch wallet balance for selected token
  const walletBalance = useBalance({
    address,
    token: selectedToken?.address === '0x0000000000000000000000000000000000000000'
      ? undefined
      : selectedToken?.address as `0x${string}`,
    chainId: selectedChainId ?? undefined,
  })

  const formattedWalletBalance = walletBalance.data
    ? parseFloat(formatUnits(walletBalance.data.value, walletBalance.data.decimals)).toFixed(4)
    : '0.00'

  // Check if the selected token is already the settlement token (no swap needed)
  const settlement = getSettlementToken(DEFAULT_ASSET)
  const isDirectDeposit = !!(
    selectedChainId &&
    selectedToken &&
    selectedChainId === settlement.chainId &&
    selectedToken.address.toLowerCase() === settlement.tokenAddress.toLowerCase()
  )

  // Debounced amount for quote fetching
  const debouncedAmount = useDebounce(amount, 500)

  // LI.FI quote
  const { quote, isLoading: quoteLoading, error: quoteError, fetchQuote, clearQuote } = useLiFiQuote()

  // Fetch quote when inputs change (skip for direct deposits — no swap needed)
  useEffect(() => {
    if (isDirectDeposit) {
      clearQuote()
      return
    }

    if (!selectedToken || !selectedChainId || !address || !debouncedAmount) {
      clearQuote()
      return
    }

    const amountNum = parseFloat(debouncedAmount)
    if (isNaN(amountNum) || amountNum <= 0) {
      clearQuote()
      return
    }

    const fromAmount = parseUnits(debouncedAmount, selectedToken.decimals).toString()

    fetchQuote({
      fromChain: selectedChainId,
      toChain: settlement.chainId,
      fromToken: selectedToken.address,
      toToken: settlement.tokenAddress,
      fromAmount,
      fromAddress: address,
    })
  }, [selectedToken, selectedChainId, address, debouncedAmount, clearQuote, fetchQuote, isDirectDeposit, settlement])

  // Transaction execution state
  const [txHash, setTxHash] = useState<string | null>(null)
  const [txError, setTxError] = useState<string | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  // Step tracking: 'swap' (LI.FI swap/bridge) → 'deposit' (Yellow custody) → 'done'
  const [fundStep, setFundStep] = useState<'idle' | 'swap' | 'deposit' | 'done'>('idle')
  const fundTxIdRef = useRef<string | null>(null)

  // Recovery state for funds stuck in custody
  const [isRecovering, setIsRecovering] = useState(false)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [recoveryDone, setRecoveryDone] = useState(false)

  const handleRecover = useCallback(async () => {
    setIsRecovering(true)
    setRecoveryError(null)
    setRecoveryDone(false)
    try {
      await recoverCustodyFunds()
      setRecoveryDone(true)
    } catch (e) {
      setRecoveryError(e instanceof Error ? e.message : 'Recovery failed')
    } finally {
      setIsRecovering(false)
    }
  }, [recoverCustodyFunds])

  // Track transaction status (skip for direct deposits — no LI.FI swap to track)
  const { status: txStatus } = useTransactionStatus(
    txHash && txHash !== 'direct-deposit' ? txHash : null,
    quote?.action.fromChainId ?? 0,
    quote?.action.toChainId ?? 0,
    quote?.tool,
  )

  // Handle fund execution
  // Direct deposit: already have the settlement token → deposit straight to custody
  // Swap path: LI.FI swap/bridge → then deposit to custody
  const handleFund = useCallback(async () => {
    if (!address) return

    // Direct deposit: skip LI.FI, deposit straight to Yellow Network
    if (isDirectDeposit && selectedToken && selectedChainId) {
      if (!amount || parseFloat(amount) <= 0) return

      setIsExecuting(true)
      setTxError(null)
      setFundStep('deposit')

      const chain = chains.find(c => c.id === selectedChainId)
      const depositAmount = parseUnits(amount, selectedToken.decimals)
      const tx = addTx({
        type: 'fund',
        status: 'pending',
        asset: selectedToken.symbol.toLowerCase(),
        amount,
        sourceToken: selectedToken.symbol,
        sourceAmount: amount,
        sourceChain: chain?.name,
      })
      fundTxIdRef.current = tx.id
      // Set a placeholder txHash so the progress UI renders
      setTxHash('direct-deposit')

      try {
        await depositToYellow(
          selectedToken.address as Address,
          depositAmount,
          selectedChainId,
        )
        setFundStep('done')
        updateTx(tx.id, { status: 'completed' })
        // Safety net: fetch fresh balances after a short delay
        setTimeout(() => fetchBalances(), 3000)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Deposit to Yellow Network failed'
        setTxError(msg)
        updateTx(tx.id, { status: 'failed' })
        setFundStep('idle')
        setTxHash(null)
      } finally {
        setIsExecuting(false)
      }
      return
    }

    // Swap path: LI.FI swap/bridge first, then deposit
    if (!quote || !walletClient || !publicClient || !selectedToken) return

    setIsExecuting(true)
    setTxError(null)
    setFundStep('swap')

    // Log to tx history
    const toAmount = formatUnits(BigInt(quote.estimate.toAmount), quote.action.toToken.decimals)
    const chain = chains.find(c => c.id === selectedChainId)
    const tx = addTx({
      type: 'fund',
      status: 'pending',
      asset: quote.action.toToken.symbol.toLowerCase(),
      amount: toAmount,
      sourceToken: selectedToken?.symbol,
      sourceAmount: amount,
      sourceChain: chain?.name,
    })
    fundTxIdRef.current = tx.id

    try {
      // Step 0: ERC-20 approval (skipped for native tokens)
      await ensureApproval(walletClient, publicClient, {
        token: selectedToken.address as Address,
        owner: address,
        spender: quote.estimate.approvalAddress as Address,
        amount: BigInt(quote.estimate.fromAmount),
      })

      // Step 1: Execute LI.FI swap/bridge
      const hash = await walletClient.sendTransaction({
        to: quote.transactionRequest.to as `0x${string}`,
        data: quote.transactionRequest.data as `0x${string}`,
        value: BigInt(quote.transactionRequest.value || '0'),
        gas: BigInt(quote.transactionRequest.gasLimit),
      })
      setTxHash(hash)
      updateTx(tx.id, { txHash: hash })
      // Step 2 triggers when txStatus becomes 'DONE' (see effect below)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transaction failed'
      if (msg.includes('rejected') || msg.includes('denied')) {
        setTxError('Transaction was rejected')
      } else {
        setTxError(msg)
      }
      updateTx(tx.id, { status: 'failed' })
      setFundStep('idle')
    } finally {
      setIsExecuting(false)
    }
  }, [quote, walletClient, publicClient, address, fetchBalances, chains, selectedChainId, selectedToken, amount, isDirectDeposit, depositToYellow])

  // When LI.FI transfer completes → deposit into Yellow Network custody
  useEffect(() => {
    if (txStatus?.status !== 'DONE' || fundStep !== 'swap') return
    if (!quote || !address) return

    const doDeposit = async () => {
      setFundStep('deposit')
      try {
        const toToken = quote.action.toToken
        const toAmount = BigInt(quote.estimate.toAmount)
        const toChainId = quote.action.toChainId

        await depositToYellow(
          toToken.address as Address,
          toAmount,
          toChainId,
        )
        setFundStep('done')
        if (fundTxIdRef.current) updateTx(fundTxIdRef.current, { status: 'completed' })
        // Safety net: fetch fresh balances after a short delay
        setTimeout(() => fetchBalances(), 3000)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Deposit to Yellow Network failed'
        setTxError(msg)
        if (fundTxIdRef.current) updateTx(fundTxIdRef.current, { status: 'failed' })
        setFundStep('idle')
      }
    }

    doDeposit()
  }, [txStatus?.status, fundStep, quote, address, depositToYellow])

  // Reset for new transaction
  const handleReset = () => {
    setTxHash(null)
    setTxError(null)
    setFundStep('idle')
    setAmount('')
    clearQuote()
  }

  // --- Render ---

  if (!walletConnected) {
    return (
      <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
        <p className="text-gray-400 text-center">
          Connect your wallet to fund your account
        </p>
      </div>
    )
  }

  // Transaction in progress or completed
  if (txHash) {
    return (
      <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-4">
        <h3 className="text-lg font-medium text-white">
          {fundStep === 'done' ? 'Funding Complete' : 'Funding in Progress'}
        </h3>

        {/* Status indicator */}
        <div className="space-y-3">
          {isDirectDeposit ? (
            // Direct deposit: only deposit + done steps
            <>
              <StatusStep
                label="Depositing to Yellow Network"
                status={
                  fundStep === 'done' ? 'done'
                  : fundStep === 'deposit' ? 'active'
                  : 'pending'
                }
              />
              <StatusStep
                label="Funds available"
                status={fundStep === 'done' ? 'done' : 'pending'}
              />
            </>
          ) : (
            // Swap path: full multi-step flow
            <>
              <StatusStep
                label="Transaction sent"
                status="done"
              />
              <StatusStep
                label="Source chain confirmation"
                status={
                  !txStatus ? 'pending'
                  : txStatus.substatus === 'WAIT_SOURCE_CONFIRMATIONS' ? 'active'
                  : 'done'
                }
              />
              <StatusStep
                label={quote?.type === 'cross' ? 'Bridging to destination' : 'Swapping tokens'}
                status={
                  !txStatus ? 'pending'
                  : txStatus.substatus === 'WAIT_DESTINATION_TRANSACTION' ? 'active'
                  : txStatus.status === 'DONE' || fundStep === 'deposit' || fundStep === 'done' ? 'done'
                  : 'pending'
                }
              />
              <StatusStep
                label="Depositing to Yellow Network"
                status={
                  fundStep === 'done' ? 'done'
                  : fundStep === 'deposit' ? 'active'
                  : 'pending'
                }
              />
              <StatusStep
                label="Funds available"
                status={fundStep === 'done' ? 'done' : 'pending'}
              />
            </>
          )}
        </div>

        {txStatus?.status === 'FAILED' && (
          <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg">
            <p className="text-sm text-red-400">
              {txStatus.substatusMessage || 'Transfer failed. Funds may be refunded.'}
            </p>
          </div>
        )}

        {fundStep === 'done' && (
          <div className="p-3 bg-green-900/20 border border-green-700 rounded-lg">
            <p className="text-sm text-green-400">
              Funds are now available in your Yellow Network account.
            </p>
            {yellowConnected && isAuthenticated && (
              <p className="text-xs text-green-500 mt-1">
                Balance: {yellowBalance} {DEFAULT_ASSET_LABEL}
              </p>
            )}
          </div>
        )}

        {(fundStep === 'done' || txStatus?.status === 'FAILED') && (
          <button
            onClick={handleReset}
            className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white
                       font-medium rounded-lg transition-colors"
          >
            Fund Again
          </button>
        )}

        {txHash && txHash !== 'direct-deposit' && (
          <p className="text-xs text-gray-500 text-center">
            {`TX: ${txHash.slice(0, 10)}...${txHash.slice(-8)}`}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-5">
      {/* Yellow Network balance */}
      {yellowConnected && isAuthenticated && (
        <div className="flex justify-between items-center p-3 bg-gray-800 rounded-lg">
          <div>
            <p className="text-xs text-gray-500">Yellow Network Balance</p>
            <p className="text-lg font-semibold text-white">{yellowBalance} {DEFAULT_ASSET_LABEL}</p>
          </div>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900/30 text-green-400 border border-green-800/50">
            Connected
          </span>
        </div>
      )}

      {/* Recovery banner — shown when funds are stuck in custody */}
      {yellowConnected && isAuthenticated && parseFloat(custodyBalance) > 0 && !recoveryDone && (
        <div className="p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg space-y-2">
          <p className="text-sm text-yellow-300">
            <strong>{custodyBalance} {DEFAULT_ASSET_LABEL}</strong> found in custody contract from a previous incomplete deposit.
          </p>
          <p className="text-xs text-yellow-400/70">
            These funds were deposited on-chain but never moved to your Yellow Network ledger. Click below to complete the process.
          </p>
          {recoveryError && (
            <p className="text-xs text-red-400">{recoveryError}</p>
          )}
          <button
            onClick={handleRecover}
            disabled={isRecovering}
            className="w-full py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-800
                       disabled:cursor-wait text-black font-medium rounded-lg transition-colors
                       text-sm flex items-center justify-center gap-2"
          >
            {isRecovering ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                Recovering funds...
              </>
            ) : (
              `Recover ${custodyBalance} ${DEFAULT_ASSET_LABEL}`
            )}
          </button>
        </div>
      )}
      {recoveryDone && (
        <div className="p-3 bg-green-900/20 border border-green-700/50 rounded-lg">
          <p className="text-sm text-green-400">
            Funds recovered successfully! Your balance has been updated.
          </p>
        </div>
      )}

      {/* Chain selector */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">
          From Chain
        </label>
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
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))
          )}
        </select>
      </div>

      {/* Unsupported chain warning */}
      {tokensError && (
        <UnsupportedChainBanner message={tokensError} supportedChainIds={supportedChainIds} />
      )}

      {/* Token selector */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">
          Token
        </label>
        <select
          value={selectedToken?.address ?? ''}
          onChange={(e) => {
            const token = availableTokens.find(t => t.address === e.target.value)
            setSelectedToken(token || null)
            setAmount('')
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

      {/* Amount input */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">
          Amount
        </label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            step="any"
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg
                       text-white placeholder-gray-500 focus:outline-none focus:ring-2
                       focus:ring-yellow-500 focus:border-transparent pr-20"
          />
          <button
            onClick={() => setAmount(formattedWalletBalance)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs
                       text-yellow-400 hover:text-yellow-300 font-medium"
          >
            MAX
          </button>
        </div>
        {amount && parseFloat(amount) > parseFloat(formattedWalletBalance) && (
          <p className="text-sm text-red-400">Insufficient wallet balance</p>
        )}
      </div>

      {/* Quote / deposit preview */}
      {isDirectDeposit && amount && parseFloat(amount) > 0 && (
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700/50 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">You deposit</span>
            <span className="text-lg font-semibold text-white">
              {amount}{' '}
              <span className="text-sm text-gray-400">{selectedToken?.symbol}</span>
            </span>
          </div>
          <div className="space-y-1.5 pt-2 border-t border-gray-700/50">
            <QuoteDetail label="Route" value="Direct deposit (no swap)" />
            <QuoteDetail label="Fee" value="Gas only" />
          </div>
        </div>
      )}

      {!isDirectDeposit && quoteLoading && amount && (
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700/50">
          <div className="flex items-center gap-2 text-gray-400">
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Finding best route...</span>
          </div>
        </div>
      )}

      {!isDirectDeposit && quote && !quoteLoading && (
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700/50 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">You receive</span>
            <span className="text-lg font-semibold text-white">
              {formatUnits(BigInt(quote.estimate.toAmount), quote.action.toToken.decimals)}{' '}
              <span className="text-sm text-gray-400">{quote.action.toToken.symbol}</span>
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
            <QuoteDetail
              label="Min received"
              value={`${formatUnits(BigInt(quote.estimate.toAmountMin), quote.action.toToken.decimals)} ${quote.action.toToken.symbol}`}
            />
          </div>
        </div>
      )}

      {quoteError && (
        <div className="p-3 bg-red-900/20 border border-red-700/50 rounded-lg">
          <p className="text-sm text-red-400">
            {quoteError.includes('No quote')
              ? 'No route found for this pair. Try a different amount or token.'
              : quoteError}
          </p>
        </div>
      )}

      {txError && (
        <div className="p-3 bg-red-900/20 border border-red-700/50 rounded-lg">
          <p className="text-sm text-red-400">{txError}</p>
        </div>
      )}

      {/* Connect to Yellow Network prompt (required before funding) */}
      {!isAuthenticated && (
        <div className="space-y-3">
          <button
            onClick={connect}
            disabled={isConnecting}
            className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 disabled:bg-yellow-600
                       disabled:cursor-wait text-black font-medium rounded-lg transition-colors
                       flex items-center justify-center gap-2"
          >
            {isConnecting ? (
              <>
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                {yellowConnected ? 'Authenticating...' : 'Connecting...'}
              </>
            ) : (
              'Connect to Yellow Network'
            )}
          </button>
          {yellowError && (
            <p className="text-sm text-red-400 text-center">{yellowError}</p>
          )}
        </div>
      )}

      {/* Fund button (only shown when authenticated) */}
      {isAuthenticated && (
        <button
          onClick={handleFund}
          disabled={
            isExecuting || quoteLoading
            || (!isDirectDeposit && !quote)
            || (isDirectDeposit && (!amount || parseFloat(amount) <= 0))
            || (!!amount && parseFloat(amount) > parseFloat(formattedWalletBalance))
          }
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
          ) : isDirectDeposit && amount && parseFloat(amount) > 0 ? (
            `Deposit ${amount} ${selectedToken?.symbol}`
          ) : quote ? (
            `Fund ${formatUnits(BigInt(quote.estimate.toAmount), quote.action.toToken.decimals)} ${quote.action.toToken.symbol}`
          ) : amount ? (
            'Enter amount for quote'
          ) : (
            'Enter amount'
          )}
        </button>
      )}

      {/* Info */}
      <p className="text-xs text-gray-500 text-center">
        Powered by LI.FI — best rates across 30+ bridges & DEXs
      </p>
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
