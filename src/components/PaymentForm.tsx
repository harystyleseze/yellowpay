'use client'

import { useState, useCallback, useEffect } from 'react'
import { useAccount } from 'wagmi'
import type { Address } from 'viem'
import { ENSInput } from './ENSInput'
import { useYellow } from '@/hooks/useYellow'
import { useENSProfile } from '@/hooks/useENS'
import { DEFAULT_ASSET_LABEL } from '@/lib/constants'

export function PaymentForm() {
  const { address: walletAddress, isConnected: walletConnected } = useAccount()
  const senderProfile = useENSProfile(walletAddress)
  const [senderAvatarOk, setSenderAvatarOk] = useState(false)

  // Reset avatar state when profile changes
  useEffect(() => {
    setSenderAvatarOk(false)
  }, [senderProfile.avatar])

  const {
    isConnected,
    isAuthenticated,
    balance,
    error,
    isConnecting,
    isSending,
    connect,
    sendPayment,
    disconnect,
  } = useYellow()

  const [recipient, setRecipient] = useState('')
  const [resolvedRecipient, setResolvedRecipient] = useState<Address | null>(null)
  const [amount, setAmount] = useState('')
  const [txStatus, setTxStatus] = useState<'idle' | 'success' | 'error'>('idle')

  // Handle connection to Yellow Network
  const handleConnect = async () => {
    setTxStatus('idle')
    await connect()
  }

  // Handle payment submission
  const handleSend = async () => {
    if (!resolvedRecipient || !amount) return

    setTxStatus('idle')

    try {
      await sendPayment(resolvedRecipient, amount)
      setTxStatus('success')
      setAmount('')
      setRecipient('')
      setResolvedRecipient(null)

      // Reset success message after 3 seconds
      setTimeout(() => setTxStatus('idle'), 3000)
    } catch (e) {
      console.error('Payment failed:', e)
      setTxStatus('error')
    }
  }

  // Handle recipient resolution
  const handleResolve = useCallback((address: `0x${string}` | null) => {
    setResolvedRecipient(address)
  }, [])

  // Validate amount
  const isValidAmount = amount && parseFloat(amount) > 0 && parseFloat(amount) <= parseFloat(balance)

  // Not wallet connected
  if (!walletConnected) {
    return (
      <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
        <p className="text-gray-400 text-center">
          Connect your wallet to start sending payments
        </p>
      </div>
    )
  }

  // Not connected to Yellow Network
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

  // Connected - show payment form
  return (
    <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-6">
      {/* Header with balance */}
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm text-gray-400">Your Balance</p>
          <p className="text-2xl font-bold text-white">{balance} {DEFAULT_ASSET_LABEL}</p>
        </div>
        <button
          onClick={disconnect}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Disconnect
        </button>
      </div>

      {/* Sender info with ENS profile */}
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

      {/* Recipient input */}
      <ENSInput
        value={recipient}
        onChange={setRecipient}
        onResolve={handleResolve}
      />

      {/* Amount input */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">
          Amount ({DEFAULT_ASSET_LABEL})
        </label>
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
                       focus:ring-blue-500 focus:border-transparent pr-16"
          />
          <button
            onClick={() => setAmount(balance)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs
                       text-blue-400 hover:text-blue-300 font-medium"
          >
            MAX
          </button>
        </div>

        {/* Amount validation */}
        {amount && parseFloat(amount) > parseFloat(balance) && (
          <p className="text-sm text-red-400">Insufficient balance</p>
        )}
      </div>

      {/* Send button */}
      <button
        onClick={handleSend}
        disabled={!resolvedRecipient || !isValidAmount || isSending}
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
          'Send Instantly'
        )}
      </button>

      {/* Transaction status */}
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
        Powered by Yellow Network &bull; No gas fees &bull; Instant confirmation
      </p>
    </div>
  )
}
