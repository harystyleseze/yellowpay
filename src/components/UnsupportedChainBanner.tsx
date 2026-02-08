'use client'

import { useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'

const BASE_CHAIN_ID = 8453

interface UnsupportedChainBannerProps {
  message: string
  supportedChainIds?: Set<number>
}

export function UnsupportedChainBanner({ message, supportedChainIds }: UnsupportedChainBannerProps) {
  const { chain: currentChain } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const [switchError, setSwitchError] = useState<string | null>(null)

  const isUnsupportedChain = currentChain && supportedChainIds && !supportedChainIds.has(currentChain.id)

  const handleSwitch = () => {
    setSwitchError(null)
    switchChain(
      { chainId: BASE_CHAIN_ID },
      {
        onError: (err) => {
          const msg = err instanceof Error ? err.message : 'Failed to switch chain'
          if (msg.includes('rejected') || msg.includes('denied')) {
            setSwitchError('Chain switch was rejected')
          } else {
            setSwitchError('Failed to switch chain')
          }
        },
      },
    )
  }

  return (
    <div className="p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg space-y-2">
      <p className="text-sm text-yellow-400">{message}</p>
      {isUnsupportedChain && (
        <>
          <p className="text-xs text-yellow-500">
            Your wallet is on {currentChain.name}. Switch to a supported chain to continue.
          </p>
          <button
            onClick={handleSwitch}
            disabled={isPending}
            className="w-full py-2 bg-yellow-500 hover:bg-yellow-400 disabled:bg-yellow-600
                       disabled:cursor-wait text-black font-medium text-sm rounded-lg
                       transition-colors flex items-center justify-center gap-2"
          >
            {isPending ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                Switching...
              </>
            ) : (
              'Switch to Base'
            )}
          </button>
          {switchError && (
            <p className="text-xs text-red-400">{switchError}</p>
          )}
        </>
      )}
    </div>
  )
}
