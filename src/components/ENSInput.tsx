'use client'

import { useState, useEffect } from 'react'
import { useENSResolve } from '@/hooks/useENS'

interface ENSInputProps {
  value: string
  onChange: (value: string) => void
  onResolve: (address: `0x${string}` | null) => void
}

export function ENSInput({ value, onChange, onResolve }: ENSInputProps) {
  const { address, avatar, isLoading, isValid, isENS, error } = useENSResolve(value)

  // Notify parent when address resolves
  useEffect(() => {
    onResolve(isValid ? address! : null)
  }, [address, isValid, onResolve])

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-300">
        Recipient
      </label>

      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="vitalik.eth or 0x..."
        className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg
                   text-white placeholder-gray-500 focus:outline-none focus:ring-2
                   focus:ring-blue-500 focus:border-transparent"
      />

      {/* Loading state */}
      {isLoading && value && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          Resolving ENS name...
        </div>
      )}

      {/* Resolved address */}
      {isValid && !isLoading && (
        <div className="flex items-center gap-3 p-3 bg-green-900/20 border border-green-700 rounded-lg">
          {avatar && (
            <img
              src={avatar}
              alt="ENS Avatar"
              className="w-8 h-8 rounded-full"
            />
          )}
          <div>
            {isENS && (
              <p className="text-sm text-green-400 font-medium">{value}</p>
            )}
            <p className="text-xs text-gray-400 font-mono">
              {address?.slice(0, 6)}...{address?.slice(-4)}
            </p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && value && (
        <p className="text-sm text-red-400">
          Could not resolve ENS name
        </p>
      )}

      {/* Invalid address format */}
      {!isValid && !isLoading && value && !error && (
        <p className="text-sm text-yellow-400">
          Enter a valid ENS name or Ethereum address
        </p>
      )}
    </div>
  )
}
