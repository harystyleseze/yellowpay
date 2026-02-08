'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { formatUnits } from 'viem'
import { useYellow } from '@/hooks/useYellow'
import { getAssetLabel } from '@/lib/constants'
import { addTx, updateTx } from '@/lib/txHistory'

export function WithdrawForm() {
  const { address, isConnected: walletConnected } = useAccount()

  const {
    isConnected,
    isAuthenticated,
    balances,
    channels,
    error,
    isConnecting,
    connect,
    withdrawFromChannel,
    disconnect,
  } = useYellow()

  const [selectedChannelId, setSelectedChannelId] = useState<`0x${string}` | null>(null)
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [withdrawStatus, setWithdrawStatus] = useState<'idle' | 'success' | 'error'>('idle')

  // Auto-select first channel
  useEffect(() => {
    if (channels.length > 0 && !selectedChannelId) {
      setSelectedChannelId(channels[0]!.channelId)
    }
  }, [channels, selectedChannelId])

  const selectedChannel = channels.find(c => c.channelId === selectedChannelId)

  const handleWithdraw = async () => {
    if (!selectedChannelId || !address) return

    setIsWithdrawing(true)
    setWithdrawStatus('idle')

    // Build amount string from selected channel
    const withdrawAmount = selectedChannel
      ? formatUnits(BigInt(selectedChannel.amount.toString()), 6)
      : '0'

    const tx = addTx({
      type: 'withdraw',
      status: 'pending',
      asset: selectedChannel?.token || 'unknown',
      amount: withdrawAmount,
      channelId: selectedChannelId,
    })

    try {
      // Full withdrawal — close the channel, send all funds to wallet
      await withdrawFromChannel(selectedChannelId, address)
      updateTx(tx.id, { status: 'completed' })
      setWithdrawStatus('success')
      setSelectedChannelId(null)

      setTimeout(() => setWithdrawStatus('idle'), 5000)
    } catch (e) {
      console.error('Withdraw failed:', e)
      updateTx(tx.id, { status: 'failed' })
      setWithdrawStatus('error')
    } finally {
      setIsWithdrawing(false)
    }
  }

  // Handle connection
  const handleConnect = async () => {
    setWithdrawStatus('idle')
    await connect()
  }

  if (!walletConnected) {
    return (
      <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
        <p className="text-gray-400 text-center">
          Connect your wallet to withdraw funds
        </p>
      </div>
    )
  }

  if (!isConnected || !isAuthenticated) {
    return (
      <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-4">
        <div className="text-center">
          <h3 className="text-lg font-medium text-white mb-2">
            Connect to Yellow Network
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            View your channels and withdraw funds
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

  // Non-zero balances
  const nonZeroBalances = balances.filter(b => parseFloat(b.amount) > 0)

  // Open channels (status = "open" or any non-closed)
  const openChannels = channels.filter(c => c.status === 'open')

  return (
    <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 space-y-5">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm text-gray-400">Ledger Balances</p>
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
            <p className="text-lg font-bold text-white">No balances</p>
          )}
        </div>
        <button
          onClick={disconnect}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Disconnect
        </button>
      </div>

      {/* Channels */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">
          Open Channels ({openChannels.length})
        </label>

        {openChannels.length === 0 ? (
          <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <p className="text-sm text-gray-400 text-center">
              No open channels to withdraw from.
            </p>
            <p className="text-xs text-gray-500 text-center mt-1">
              Channels are created when you deposit funds.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {openChannels.map(channel => (
              <button
                key={channel.channelId}
                onClick={() => setSelectedChannelId(channel.channelId)}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  selectedChannelId === channel.channelId
                    ? 'bg-gray-800 border-yellow-500/50'
                    : 'bg-gray-800/50 border-gray-700/50 hover:border-gray-600'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-white font-medium">
                      Chain {channel.chainId}
                    </p>
                    <p className="text-xs text-gray-500 font-mono">
                      {channel.channelId.slice(0, 10)}...{channel.channelId.slice(-8)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-white font-semibold">
                      {formatUnits(BigInt(channel.amount.toString()), 6)}
                    </p>
                    <p className="text-xs text-gray-500">{channel.status}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Withdraw destination */}
      {selectedChannel && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">
            Withdraw to
          </label>
          <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <p className="text-xs text-gray-500">Your wallet</p>
            <p className="text-sm text-white font-mono">
              {address?.slice(0, 10)}...{address?.slice(-8)}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Chain {selectedChannel.chainId} &bull; Closes the channel and returns all funds on-chain
            </p>
          </div>
        </div>
      )}

      {/* Withdraw button */}
      <button
        onClick={handleWithdraw}
        disabled={!selectedChannelId || isWithdrawing || openChannels.length === 0}
        className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700
                   disabled:cursor-not-allowed text-black disabled:text-gray-400
                   font-medium rounded-lg transition-colors
                   flex items-center justify-center gap-2"
      >
        {isWithdrawing ? (
          <>
            <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            Withdrawing...
          </>
        ) : openChannels.length === 0 ? (
          'No channels to withdraw'
        ) : (
          'Withdraw to Wallet'
        )}
      </button>

      {/* Status */}
      {withdrawStatus === 'success' && (
        <div className="p-3 bg-green-900/20 border border-green-700 rounded-lg">
          <p className="text-sm text-green-400 text-center">
            Withdrawal initiated! Funds will settle on-chain shortly.
          </p>
        </div>
      )}

      {withdrawStatus === 'error' && (
        <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg">
          <p className="text-sm text-red-400 text-center">
            {error || 'Withdrawal failed. Please try again.'}
          </p>
        </div>
      )}

      <p className="text-xs text-gray-500 text-center">
        Withdrawing closes your channel and settles funds on-chain.
      </p>
    </div>
  )
}
