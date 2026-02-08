'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAccount, useWalletClient, useBalance } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { useEarnVaults, useEarnPositions, addEarnDeposit, removeEarnDeposit } from '@/hooks/useEarn'
import { useLiFiQuote, useLiFiChains, useLiFiTokens, useTransactionStatus } from '@/hooks/useLiFi'
import { getAssetLabel, DEFAULT_ASSET_LABEL } from '@/lib/constants'
import { addTx, updateTx } from '@/lib/txHistory'
import type { EarnVault, EarnPosition } from '@/lib/earn'
import type { LiFiToken } from '@/lib/lifi'

// Debounce hook (same as FundAccount)
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

type View = 'overview' | 'deposit' | 'withdraw'
type DepositStep = 'idle' | 'confirming' | 'depositing' | 'done'
type WithdrawStep = 'idle' | 'confirming' | 'withdrawing' | 'done'

const RISK_COLORS: Record<string, string> = {
  low: 'text-green-400 bg-green-900/20 border-green-800/50',
  medium: 'text-yellow-400 bg-yellow-900/20 border-yellow-800/50',
  high: 'text-red-400 bg-red-900/20 border-red-800/50',
}

export function EarnDashboard() {
  const { address, isConnected: walletConnected, chain: currentChain } = useAccount()
  const { data: walletClient } = useWalletClient()

  const { vaults, isLoading: vaultsLoading, error: vaultsError } = useEarnVaults()
  const { positions, isLoading: positionsLoading, error: positionsError, refresh: refreshPositions } = useEarnPositions()

  const [view, setView] = useState<View>('overview')
  const [selectedVault, setSelectedVault] = useState<EarnVault | null>(null)
  const [selectedPosition, setSelectedPosition] = useState<EarnPosition | null>(null)
  const [amount, setAmount] = useState('')
  const [depositStep, setDepositStep] = useState<DepositStep>('idle')
  const [withdrawStep, setWithdrawStep] = useState<WithdrawStep>('idle')
  const [lastWithdrawResult, setLastWithdrawResult] = useState<EarnPosition | null>(null)

  // ─── Production LI.FI state ───
  const { chains, isLoading: chainsLoading, supportedChainIds } = useLiFiChains()
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null)
  const [selectedToken, setSelectedToken] = useState<LiFiToken | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [txError, setTxError] = useState<string | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const fundTxIdRef = useRef<string | null>(null)

  // Set initial chain
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
  const { tokens: tokenMap, isLoading: tokensLoading } = useLiFiTokens(chainIds, supportedChainIds)
  const availableTokens = useMemo(
    () => selectedChainId ? (tokenMap[selectedChainId] || []) : [],
    [selectedChainId, tokenMap]
  )

  // Reset token when chain changes
  useEffect(() => {
    setSelectedToken(null)
    setAmount('')
  }, [selectedChainId])

  // Auto-select native token when tokens load
  useEffect(() => {
    if (availableTokens.length > 0 && !selectedToken) {
      const native = availableTokens.find(
        t => t.address === '0x0000000000000000000000000000000000000000'
      )
      setSelectedToken(native || availableTokens[0] || null)
    }
  }, [availableTokens, selectedToken])

  // Wallet balance for selected token
  const walletBalance = useBalance({
    address,
    token: selectedToken?.address === '0x0000000000000000000000000000000000000000'
      ? undefined
      : selectedToken?.address as `0x${string}`,
    chainId: selectedChainId ?? undefined,
    query: { enabled: !!selectedToken },
  })

  const formattedWalletBalance = walletBalance.data
    ? parseFloat(formatUnits(walletBalance.data.value, walletBalance.data.decimals)).toFixed(4)
    : '0.00'

  // Debounced amount for quote
  const debouncedAmount = useDebounce(amount, 500)

  // LI.FI quote
  const { quote, isLoading: quoteLoading, error: quoteError, fetchQuote, clearQuote } = useLiFiQuote()

  // Fetch quote for deposit
  useEffect(() => {
    if (view !== 'deposit' || !selectedVault) return
    if (!selectedToken || !selectedChainId || !address || !debouncedAmount) {
      clearQuote()
      return
    }
    if (!selectedVault.aTokenAddress || !selectedVault.chainId) {
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
      toChain: selectedVault.chainId,
      fromToken: selectedToken.address,
      toToken: selectedVault.aTokenAddress,
      fromAmount,
      fromAddress: address,
    })
  }, [selectedToken, selectedChainId, address, debouncedAmount, clearQuote, fetchQuote, selectedVault, view])

  // LI.FI quote for withdraw
  const { quote: withdrawQuote, isLoading: withdrawQuoteLoading, error: withdrawQuoteError, fetchQuote: fetchWithdrawQuote, clearQuote: clearWithdrawQuote } = useLiFiQuote()

  // Fetch withdraw quote when position is selected
  useEffect(() => {
    if (view !== 'withdraw' || !selectedPosition) return
    if (!address) return

    const vault = selectedPosition.vault
    if (!vault.aTokenAddress || !vault.chainId || !vault.tokenAddress || !vault.tokenDecimals) {
      clearWithdrawQuote()
      return
    }
    if (selectedPosition.currentAmount <= 0) {
      clearWithdrawQuote()
      return
    }

    const fromAmount = parseUnits(
      selectedPosition.currentAmount.toString(),
      vault.tokenDecimals
    ).toString()

    fetchWithdrawQuote({
      fromChain: vault.chainId,
      toChain: vault.chainId,
      fromToken: vault.aTokenAddress,
      toToken: vault.tokenAddress,
      fromAmount,
      fromAddress: address,
    })
  }, [selectedPosition, address, view, fetchWithdrawQuote, clearWithdrawQuote])

  // Transaction status polling for deposit
  const { status: depositTxStatus } = useTransactionStatus(
    view === 'deposit' ? txHash : null,
    selectedChainId ?? 0,
    selectedVault?.chainId ?? 0,
    quote?.tool,
  )

  // Transaction status polling for withdraw
  const { status: withdrawTxStatus } = useTransactionStatus(
    view === 'withdraw' ? txHash : null,
    selectedPosition?.vault.chainId ?? 0,
    selectedPosition?.vault.chainId ?? 0,
    withdrawQuote?.tool,
  )

  // Handle deposit tx completion
  useEffect(() => {
    if (view !== 'deposit' || depositStep !== 'depositing') return
    if (depositTxStatus?.status !== 'DONE') return
    if (!selectedVault || !quote) return

    // Save deposit to localStorage
    const toAmount = formatUnits(BigInt(quote.estimate.toAmount), quote.action.toToken.decimals)
    if (selectedVault.aTokenAddress && selectedVault.chainId && selectedVault.tokenAddress && selectedVault.tokenDecimals != null) {
      addEarnDeposit(
        selectedVault.id,
        selectedVault.aTokenAddress,
        selectedVault.chainId,
        toAmount,
        selectedVault.tokenDecimals,
        selectedVault.tokenAddress,
        selectedVault.asset,
      )
    }

    addTx({
      type: 'earn_deposit',
      status: 'completed',
      asset: selectedVault.asset,
      amount: toAmount,
      vaultId: selectedVault.id,
      vaultName: selectedVault.name,
      txHash: txHash || undefined,
    })
    if (fundTxIdRef.current) updateTx(fundTxIdRef.current, { status: 'completed' })

    setDepositStep('done')
    refreshPositions()
  }, [depositTxStatus?.status, depositStep, selectedVault, quote, txHash, view, refreshPositions])

  // Handle withdraw tx completion
  useEffect(() => {
    if (view !== 'withdraw' || withdrawStep !== 'withdrawing') return
    if (withdrawTxStatus?.status !== 'DONE') return
    if (!selectedPosition) return

    const vault = selectedPosition.vault
    if (vault.aTokenAddress && vault.chainId) {
      removeEarnDeposit(vault.aTokenAddress, vault.chainId)
    }

    addTx({
      type: 'earn_withdraw',
      status: 'completed',
      asset: selectedPosition.asset,
      amount: selectedPosition.currentAmount.toFixed(2),
      vaultId: vault.id,
      vaultName: vault.name,
      yieldEarned: selectedPosition.accruedYield.toFixed(4),
      txHash: txHash || undefined,
    })
    if (fundTxIdRef.current) updateTx(fundTxIdRef.current, { status: 'completed' })

    setWithdrawStep('done')
    setLastWithdrawResult(selectedPosition)
    refreshPositions()
  }, [withdrawTxStatus?.status, withdrawStep, selectedPosition, txHash, view, refreshPositions])

  // ─── Deposit handler (LI.FI) ───
  const handleDeposit = useCallback(async () => {
    if (!quote || !walletClient || !address || !selectedVault) return

    setIsExecuting(true)
    setTxError(null)
    setDepositStep('confirming')

    const toAmount = formatUnits(BigInt(quote.estimate.toAmount), quote.action.toToken.decimals)
    const tx = addTx({
      type: 'earn_deposit',
      status: 'pending',
      asset: selectedVault.asset,
      amount: toAmount,
      vaultId: selectedVault.id,
      vaultName: selectedVault.name,
      sourceToken: selectedToken?.symbol,
      sourceAmount: amount,
      sourceChain: chains.find(c => c.id === selectedChainId)?.name,
    })
    fundTxIdRef.current = tx.id

    try {
      await new Promise(r => setTimeout(r, 300))
      setDepositStep('depositing')

      const hash = await walletClient.sendTransaction({
        to: quote.transactionRequest.to as `0x${string}`,
        data: quote.transactionRequest.data as `0x${string}`,
        value: BigInt(quote.transactionRequest.value || '0'),
        gas: BigInt(quote.transactionRequest.gasLimit),
      })
      setTxHash(hash)
      updateTx(tx.id, { txHash: hash })
      // depositStep stays 'depositing' — completion handled by depositTxStatus effect
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transaction failed'
      if (msg.includes('rejected') || msg.includes('denied')) {
        setTxError('Transaction was rejected')
      } else {
        setTxError(msg)
      }
      updateTx(tx.id, { status: 'failed' })
      setDepositStep('idle')
    } finally {
      setIsExecuting(false)
    }
  }, [quote, walletClient, address, selectedVault, selectedToken, amount, chains, selectedChainId])

  // ─── Withdraw handler (LI.FI) ───
  const handleWithdraw = useCallback(async () => {
    if (!withdrawQuote || !walletClient || !address || !selectedPosition) return

    setIsExecuting(true)
    setTxError(null)
    setWithdrawStep('confirming')

    const tx = addTx({
      type: 'earn_withdraw',
      status: 'pending',
      asset: selectedPosition.asset,
      amount: selectedPosition.currentAmount.toFixed(2),
      vaultId: selectedPosition.vault.id,
      vaultName: selectedPosition.vault.name,
    })
    fundTxIdRef.current = tx.id

    try {
      await new Promise(r => setTimeout(r, 300))
      setWithdrawStep('withdrawing')

      const hash = await walletClient.sendTransaction({
        to: withdrawQuote.transactionRequest.to as `0x${string}`,
        data: withdrawQuote.transactionRequest.data as `0x${string}`,
        value: BigInt(withdrawQuote.transactionRequest.value || '0'),
        gas: BigInt(withdrawQuote.transactionRequest.gasLimit),
      })
      setTxHash(hash)
      updateTx(tx.id, { txHash: hash })
      // withdrawStep stays 'withdrawing' — completion handled by withdrawTxStatus effect
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transaction failed'
      if (msg.includes('rejected') || msg.includes('denied')) {
        setTxError('Transaction was rejected')
      } else {
        setTxError(msg)
      }
      updateTx(tx.id, { status: 'failed' })
      setWithdrawStep('idle')
    } finally {
      setIsExecuting(false)
    }
  }, [withdrawQuote, walletClient, address, selectedPosition])

  // Auth guard: wallet not connected
  if (!walletConnected) {
    return (
      <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
        <p className="text-gray-400 text-center">
          Connect your wallet to access Earn
        </p>
      </div>
    )
  }

  // Portfolio summary
  const totalDeposited = positions.reduce((sum, p) => sum + p.depositedAmount, 0)
  const totalCurrent = positions.reduce((sum, p) => sum + p.currentAmount, 0)
  const totalYield = positions.reduce((sum, p) => sum + p.accruedYield, 0)

  // Vault sorting
  const sortedVaults = [...vaults].sort((a, b) => b.apyPercent - a.apyPercent)

  const handleStartDeposit = (vault: EarnVault) => {
    setSelectedVault(vault)
    setAmount('')
    setDepositStep('idle')
    setTxHash(null)
    setTxError(null)
    clearQuote()
    setView('deposit')
  }

  const handleStartWithdraw = (position: EarnPosition) => {
    setSelectedPosition(position)
    setWithdrawStep('idle')
    setLastWithdrawResult(null)
    setTxHash(null)
    setTxError(null)
    clearWithdrawQuote()
    setView('withdraw')
  }

  const handleBack = () => {
    setView('overview')
    setSelectedVault(null)
    setSelectedPosition(null)
    setDepositStep('idle')
    setWithdrawStep('idle')
    setLastWithdrawResult(null)
    setTxHash(null)
    setTxError(null)
    clearQuote()
    clearWithdrawQuote()
  }

  // ─── Deposit View ───
  if (view === 'deposit' && selectedVault) {
    // Deposit with LI.FI tx in progress
    if (txHash && depositStep !== 'idle') {
      return (
        <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-4">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-lg font-medium text-white">
                {depositStep === 'done' ? 'Deposit Complete' : 'Deposit in Progress'}
              </h3>
              <p className="text-xs text-gray-500">{selectedVault.name}</p>
            </div>
          </div>

          <div className="space-y-3">
            <StatusStep label="Transaction sent" status="done" />
            <StatusStep
              label="Source chain confirmation"
              status={
                !depositTxStatus ? 'pending'
                : depositTxStatus.substatus === 'WAIT_SOURCE_CONFIRMATIONS' ? 'active'
                : 'done'
              }
            />
            <StatusStep
              label="Supplying to Aave V3"
              status={
                !depositTxStatus ? 'pending'
                : depositTxStatus.substatus === 'WAIT_DESTINATION_TRANSACTION' ? 'active'
                : depositTxStatus.status === 'DONE' || depositStep === 'done' ? 'done'
                : 'pending'
              }
            />
            <StatusStep
              label="Position active"
              status={depositStep === 'done' ? 'done' : 'pending'}
            />
          </div>

          {depositTxStatus?.status === 'FAILED' && (
            <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg">
              <p className="text-sm text-red-400">
                {depositTxStatus.substatusMessage || 'Transfer failed. Funds may be refunded.'}
              </p>
            </div>
          )}

          {depositStep === 'done' && (
            <div className="p-3 bg-green-900/20 border border-green-700 rounded-lg">
              <p className="text-sm text-green-400 text-center">
                Successfully deposited into {selectedVault.name}
              </p>
              <p className="text-xs text-green-500 text-center mt-1">
                Yield will start accruing immediately at ~{selectedVault.apyPercent.toFixed(1)}% APY
              </p>
            </div>
          )}

          {(depositStep === 'done' || depositTxStatus?.status === 'FAILED') && (
            <button
              onClick={handleBack}
              className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
            >
              Back to Overview
            </button>
          )}

          <p className="text-xs text-gray-500 text-center">
            TX: {txHash.slice(0, 10)}...{txHash.slice(-8)}
          </p>
        </div>
      )
    }

    return (
      <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h3 className="text-lg font-medium text-white">Deposit to {selectedVault.name}</h3>
            <p className="text-xs text-gray-500">{selectedVault.protocol} &bull; {selectedVault.apyPercent.toFixed(1)}% APY</p>
          </div>
        </div>

        {depositStep === 'done' ? (
          <>
            <div className="space-y-3">
              <StatusStep label="Deposit confirmed" status="done" />
              <StatusStep label="Depositing to vault" status="done" />
              <StatusStep label="Position active" status="done" />
            </div>
            <div className="p-3 bg-green-900/20 border border-green-700 rounded-lg">
              <p className="text-sm text-green-400 text-center">
                Successfully deposited {amount} {getAssetLabel(selectedVault.asset)} into {selectedVault.name}
              </p>
              <p className="text-xs text-green-500 text-center mt-1">
                Yield will start accruing immediately at ~{selectedVault.apyPercent.toFixed(1)}% APY
              </p>
            </div>
            <button
              onClick={handleBack}
              className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
            >
              Back to Overview
            </button>
          </>
        ) : depositStep !== 'idle' ? (
          <div className="space-y-3">
            <StatusStep label="Deposit confirmed" status={depositStep === 'confirming' ? 'active' : 'done'} />
            <StatusStep label="Depositing to vault" status={depositStep === 'depositing' ? 'active' : 'pending'} />
            <StatusStep label="Position active" status="pending" />
            {txError && (
              <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg">
                <p className="text-sm text-red-400">{txError}</p>
              </div>
            )}
          </div>
        ) : (
          // ─── Production deposit form (LI.FI) ───
          <>
            {/* Chain selector */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">From Chain</label>
              <select
                value={selectedChainId ?? ''}
                onChange={(e) => setSelectedChainId(Number(e.target.value))}
                disabled={chainsLoading}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg
                           text-white focus:outline-none focus:ring-2 focus:ring-emerald-500
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

            {/* Token selector */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Token</label>
              <select
                value={selectedToken?.address ?? ''}
                onChange={(e) => {
                  const token = availableTokens.find(t => t.address === e.target.value)
                  setSelectedToken(token || null)
                  setAmount('')
                }}
                disabled={tokensLoading || availableTokens.length === 0}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg
                           text-white focus:outline-none focus:ring-2 focus:ring-emerald-500
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
                </p>
              )}
            </div>

            {/* Amount input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Amount</label>
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
                             focus:ring-emerald-500 focus:border-transparent pr-20"
                />
                <button
                  onClick={() => setAmount(formattedWalletBalance)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs
                             text-emerald-400 hover:text-emerald-300 font-medium"
                >
                  MAX
                </button>
              </div>
              {amount && parseFloat(amount) > parseFloat(formattedWalletBalance) && (
                <p className="text-sm text-red-400">Insufficient wallet balance</p>
              )}
            </div>

            {/* Quote preview */}
            {quoteLoading && amount && (
              <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700/50">
                <div className="flex items-center gap-2 text-gray-400">
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">Finding best route...</span>
                </div>
              </div>
            )}

            {quote && !quoteLoading && (
              <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700/50 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">You deposit</span>
                  <span className="text-lg font-semibold text-white">
                    {formatUnits(BigInt(quote.estimate.toAmount), quote.action.toToken.decimals)}{' '}
                    <span className="text-sm text-gray-400">{quote.action.toToken.symbol}</span>
                  </span>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-gray-700/50">
                  <QuoteDetail
                    label="Route"
                    value={`${quote.toolDetails.name} (${quote.type === 'cross' ? 'bridge + supply' : 'swap + supply'})`}
                  />
                  <QuoteDetail
                    label="Estimated time"
                    value={quote.estimate.executionDuration < 60
                      ? `~${quote.estimate.executionDuration}s`
                      : `~${Math.ceil(quote.estimate.executionDuration / 60)} min`
                    }
                  />
                  {quote.estimate.gasCosts[0] && (
                    <QuoteDetail label="Gas cost" value={`~$${quote.estimate.gasCosts[0].amountUSD}`} />
                  )}
                  {quote.estimate.feeCosts[0] && (
                    <QuoteDetail label="Fee" value={`~$${quote.estimate.feeCosts[0].amountUSD}`} />
                  )}
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

            {/* Vault info */}
            <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/50 space-y-1.5">
              <DetailRow label="Vault" value={selectedVault.name} />
              <DetailRow label="Protocol" value={selectedVault.protocol} />
              <DetailRow label="APY" value={`${selectedVault.apyPercent.toFixed(1)}%`} />
              <DetailRow label="Risk" value={selectedVault.riskLevel} />
            </div>

            <button
              onClick={handleDeposit}
              disabled={!quote || isExecuting || quoteLoading || (!!amount && parseFloat(amount) > parseFloat(formattedWalletBalance))}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700
                         disabled:cursor-not-allowed text-white disabled:text-gray-400
                         font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isExecuting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Confirming...
                </>
              ) : quote ? (
                `Deposit ${formatUnits(BigInt(quote.estimate.toAmount), quote.action.toToken.decimals)} ${quote.action.toToken.symbol}`
              ) : amount ? (
                'Enter amount for quote'
              ) : (
                'Enter amount'
              )}
            </button>

            <p className="text-xs text-gray-500 text-center">
              Powered by LI.FI — swap + bridge + supply in one transaction
            </p>
          </>
        )}
      </div>
    )
  }

  // ─── Withdraw View ───
  if (view === 'withdraw' && selectedPosition) {
    // Withdraw with LI.FI tx in progress
    if (txHash && withdrawStep !== 'idle') {
      return (
        <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-4">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-lg font-medium text-white">
                {withdrawStep === 'done' ? 'Withdrawal Complete' : 'Withdrawal in Progress'}
              </h3>
              <p className="text-xs text-gray-500">{selectedPosition.vault.name}</p>
            </div>
          </div>

          <div className="space-y-3">
            <StatusStep label="Transaction sent" status="done" />
            <StatusStep
              label="Withdrawing from Aave V3"
              status={
                !withdrawTxStatus ? 'pending'
                : withdrawTxStatus.status === 'DONE' || withdrawStep === 'done' ? 'done'
                : 'active'
              }
            />
            <StatusStep
              label="Funds returned"
              status={withdrawStep === 'done' ? 'done' : 'pending'}
            />
          </div>

          {withdrawTxStatus?.status === 'FAILED' && (
            <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg">
              <p className="text-sm text-red-400">
                {withdrawTxStatus.substatusMessage || 'Withdrawal failed.'}
              </p>
            </div>
          )}

          {withdrawStep === 'done' && (
            <div className="p-3 bg-green-900/20 border border-green-700 rounded-lg space-y-1">
              <p className="text-sm text-green-400 text-center">Withdrawal complete</p>
              <div className="flex justify-between text-xs">
                <span className="text-green-500">Deposited</span>
                <span className="text-green-400">{selectedPosition.depositedAmount.toFixed(2)} {getAssetLabel(selectedPosition.asset)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-green-500">Yield earned</span>
                <span className="text-green-400">+{selectedPosition.accruedYield.toFixed(4)} {getAssetLabel(selectedPosition.asset)}</span>
              </div>
              <div className="flex justify-between text-xs font-medium pt-1 border-t border-green-800/50">
                <span className="text-green-400">Total returned</span>
                <span className="text-green-300">{selectedPosition.currentAmount.toFixed(2)} {getAssetLabel(selectedPosition.asset)}</span>
              </div>
            </div>
          )}

          {(withdrawStep === 'done' || withdrawTxStatus?.status === 'FAILED') && (
            <button
              onClick={handleBack}
              className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
            >
              Back to Overview
            </button>
          )}

          <p className="text-xs text-gray-500 text-center">
            TX: {txHash.slice(0, 10)}...{txHash.slice(-8)}
          </p>
        </div>
      )
    }

    return (
      <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h3 className="text-lg font-medium text-white">Withdraw from {selectedPosition.vault.name}</h3>
            <p className="text-xs text-gray-500">{selectedPosition.vault.protocol}</p>
          </div>
        </div>

        {withdrawStep === 'done' && lastWithdrawResult ? (
          <>
            <div className="space-y-3">
              <StatusStep label="Withdraw confirmed" status="done" />
              <StatusStep label="Withdrawing from vault" status="done" />
              <StatusStep label="Funds returned" status="done" />
            </div>
            <div className="p-3 bg-green-900/20 border border-green-700 rounded-lg space-y-1">
              <p className="text-sm text-green-400 text-center">Withdrawal complete</p>
              <div className="flex justify-between text-xs">
                <span className="text-green-500">Deposited</span>
                <span className="text-green-400">{lastWithdrawResult.depositedAmount.toFixed(2)} {getAssetLabel(lastWithdrawResult.asset)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-green-500">Yield earned</span>
                <span className="text-green-400">+{lastWithdrawResult.accruedYield.toFixed(4)} {getAssetLabel(lastWithdrawResult.asset)}</span>
              </div>
              <div className="flex justify-between text-xs font-medium pt-1 border-t border-green-800/50">
                <span className="text-green-400">Total returned</span>
                <span className="text-green-300">{lastWithdrawResult.currentAmount.toFixed(2)} {getAssetLabel(lastWithdrawResult.asset)}</span>
              </div>
            </div>
            <button
              onClick={handleBack}
              className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
            >
              Back to Overview
            </button>
          </>
        ) : withdrawStep !== 'idle' ? (
          <div className="space-y-3">
            <StatusStep label="Withdraw confirmed" status={withdrawStep === 'confirming' ? 'active' : 'done'} />
            <StatusStep label="Withdrawing from vault" status={withdrawStep === 'withdrawing' ? 'active' : 'pending'} />
            <StatusStep label="Funds returned" status="pending" />
            {txError && (
              <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg">
                <p className="text-sm text-red-400">{txError}</p>
              </div>
            )}
          </div>
        ) : (
          // ─── Production withdraw form (LI.FI) ───
          <>
            <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700/50 space-y-2">
              <DetailRow label="Deposited" value={`${selectedPosition.depositedAmount.toFixed(2)} ${getAssetLabel(selectedPosition.asset)}`} />
              <DetailRow label="Current value" value={`${selectedPosition.currentAmount.toFixed(4)} ${getAssetLabel(selectedPosition.asset)}`} />
              <DetailRow label="Yield earned" value={`+${selectedPosition.accruedYield.toFixed(4)} ${getAssetLabel(selectedPosition.asset)}`} valueClass="text-emerald-400" />
              <DetailRow label="APY" value={`${selectedPosition.vault.apyPercent.toFixed(1)}%`} />
              <DetailRow label="Since" value={new Date(selectedPosition.depositTimestamp).toLocaleDateString()} />
            </div>

            {/* Withdraw quote preview */}
            {withdrawQuoteLoading && (
              <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700/50">
                <div className="flex items-center gap-2 text-gray-400">
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">Finding withdrawal route...</span>
                </div>
              </div>
            )}

            {withdrawQuote && !withdrawQuoteLoading && (
              <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700/50 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">You receive</span>
                  <span className="text-lg font-semibold text-white">
                    {formatUnits(BigInt(withdrawQuote.estimate.toAmount), withdrawQuote.action.toToken.decimals)}{' '}
                    <span className="text-sm text-gray-400">{withdrawQuote.action.toToken.symbol}</span>
                  </span>
                </div>
                <div className="space-y-1.5 pt-2 border-t border-gray-700/50">
                  <QuoteDetail
                    label="Route"
                    value={`${withdrawQuote.toolDetails.name} (withdraw)`}
                  />
                  {withdrawQuote.estimate.gasCosts[0] && (
                    <QuoteDetail label="Gas cost" value={`~$${withdrawQuote.estimate.gasCosts[0].amountUSD}`} />
                  )}
                </div>
              </div>
            )}

            {withdrawQuoteError && (
              <div className="p-3 bg-red-900/20 border border-red-700/50 rounded-lg">
                <p className="text-sm text-red-400">{withdrawQuoteError}</p>
              </div>
            )}

            {txError && (
              <div className="p-3 bg-red-900/20 border border-red-700/50 rounded-lg">
                <p className="text-sm text-red-400">{txError}</p>
              </div>
            )}

            <button
              onClick={handleWithdraw}
              disabled={!withdrawQuote || isExecuting || withdrawQuoteLoading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700
                         disabled:cursor-not-allowed text-white disabled:text-gray-400
                         font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isExecuting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Confirming...
                </>
              ) : withdrawQuote ? (
                `Withdraw ${formatUnits(BigInt(withdrawQuote.estimate.toAmount), withdrawQuote.action.toToken.decimals)} ${withdrawQuote.action.toToken.symbol}`
              ) : (
                'Loading quote...'
              )}
            </button>

            <p className="text-xs text-gray-500 text-center">
              Powered by LI.FI — withdraw from Aave V3 in one transaction
            </p>
          </>
        )}
      </div>
    )
  }

  // ─── Overview (default) ───
  return (
    <div className="space-y-4">
      {/* Portfolio Summary */}
      <div className="p-5 bg-gradient-to-br from-emerald-900/30 to-gray-900 rounded-xl border border-emerald-800/30">
        <p className="text-xs text-emerald-400 uppercase tracking-wide font-medium mb-3">Earn Portfolio</p>
        <div className="flex justify-between items-end">
          <div>
            <p className="text-2xl font-bold text-white">
              {totalCurrent.toFixed(2)} <span className="text-sm text-gray-400">{DEFAULT_ASSET_LABEL}</span>
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Deposited: {totalDeposited.toFixed(2)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-emerald-400">
              +{totalYield.toFixed(4)}
            </p>
            <p className="text-xs text-emerald-500">yield earned</p>
          </div>
        </div>
      </div>

      {/* Active Positions */}
      {positions.length > 0 && (
        <div className="p-4 bg-gray-900 rounded-xl border border-gray-800 space-y-3">
          <h4 className="text-sm font-medium text-gray-300">Active Positions ({positions.length})</h4>
          <div className="space-y-2">
            {positions.map(position => (
              <div
                key={position.id}
                className="p-3 bg-gray-800/60 rounded-lg border border-gray-700/50"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-sm font-medium text-white">{position.vault.name}</p>
                    <p className="text-xs text-gray-500">{position.vault.protocol} &bull; {position.vault.apyPercent.toFixed(1)}% APY</p>
                  </div>
                  <button
                    onClick={() => handleStartWithdraw(position)}
                    className="text-xs px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600
                               text-gray-300 hover:text-white transition-colors"
                  >
                    Withdraw
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[10px] text-gray-500">Deposited</p>
                    <p className="text-xs text-white">{position.depositedAmount.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">Current</p>
                    <p className="text-xs text-white">{position.currentAmount.toFixed(4)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">Yield</p>
                    <p className="text-xs text-emerald-400">+{position.accruedYield.toFixed(4)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available Vaults */}
      <div className="p-4 bg-gray-900 rounded-xl border border-gray-800 space-y-3">
        <div className="flex justify-between items-center">
          <h4 className="text-sm font-medium text-gray-300">Available Vaults</h4>
          {vaultsLoading && (
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {vaultsError && (
          <div className="p-3 bg-red-900/20 border border-red-700/50 rounded-lg">
            <p className="text-sm text-red-400">{vaultsError}</p>
          </div>
        )}

        {positionsError && (
          <div className="p-3 bg-red-900/20 border border-red-700/50 rounded-lg">
            <p className="text-sm text-red-400">{positionsError}</p>
          </div>
        )}

        {!vaultsLoading && sortedVaults.length === 0 && !vaultsError && (
          <p className="text-sm text-gray-500 text-center py-4">No vaults available</p>
        )}

        <div className="space-y-2">
          {sortedVaults.map(vault => (
            <div
              key={vault.id}
              className="p-3 bg-gray-800/60 rounded-lg border border-gray-700/50"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{vault.name}</p>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${RISK_COLORS[vault.riskLevel]}`}>
                      {vault.riskLevel}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">{vault.protocol}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <p className="text-lg font-bold text-emerald-400">{vault.apyPercent.toFixed(1)}%</p>
                  <p className="text-[10px] text-gray-500">APY</p>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <p className="text-[10px] text-gray-500">
                  {vault.tvlUsd != null
                    ? `TVL: $${(vault.tvlUsd / 1_000_000).toFixed(0)}M • `
                    : ''
                  }
                  {vault.minDeposit > 0
                    ? `Min: ${vault.minDeposit} ${getAssetLabel(vault.asset)}`
                    : `${getAssetLabel(vault.asset)}`
                  }
                </p>
                <button
                  onClick={() => handleStartDeposit(vault)}
                  className="text-xs px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500
                             text-white font-medium transition-colors"
                >
                  Deposit
                </button>
              </div>
              <p className="text-[10px] text-gray-600 mt-1.5">{vault.description}</p>
            </div>
          ))}
        </div>
      </div>

      {positionsLoading && positions.length === 0 && (
        <p className="text-xs text-gray-500 text-center">Loading positions...</p>
      )}
    </div>
  )
}

// ─── Sub-components ───

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
          <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <div className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
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
        status === 'active' ? 'text-emerald-400' :
        'text-gray-500'
      }`}>
        {label}
      </span>
    </div>
  )
}

function QuoteDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs text-gray-300">{value}</span>
    </div>
  )
}

function DetailRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xs ${valueClass || 'text-gray-300'}`}>{value}</span>
    </div>
  )
}
