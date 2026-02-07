'use client'

import { useEffect } from 'react'
import Image from 'next/image'
import { useENSResolve, useENSTextRecords } from '@/hooks/useENS'

interface ENSInputProps {
  value: string
  onChange: (value: string) => void
  onResolve: (address: `0x${string}` | null) => void
}

export function ENSInput({ value, onChange, onResolve }: ENSInputProps) {
  const { address, name, avatar, isLoading, isValid, isENS, error } = useENSResolve(value)
  const textRecords = useENSTextRecords(isENS ? name : null)

  // Notify parent when address resolves
  useEffect(() => {
    onResolve(isValid ? address : null)
  }, [address, isValid, onResolve])

  const isTyping = value.length > 0

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-300">
        Recipient
      </label>

      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="ENS name, DNS name, or 0x address"
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg
                     text-white placeholder-gray-500 focus:outline-none focus:ring-2
                     focus:ring-blue-500 focus:border-transparent"
        />
        {isLoading && isTyping && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Resolved result card */}
      {isValid && !isLoading && (
        <div className="p-3 bg-gray-800/80 border border-green-800/50 rounded-lg space-y-2">
          <div className="flex items-center gap-3">
            {avatar ? (
              <Image
                src={avatar}
                alt="ENS Avatar"
                width={36}
                height={36}
                className="w-9 h-9 rounded-full ring-2 ring-green-700/50"
                unoptimized
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                {(name || value)?.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              {name && (
                <p className="text-sm text-green-400 font-medium truncate">{name}</p>
              )}
              <p className="text-xs text-gray-400 font-mono truncate">
                {address}
              </p>
            </div>
            <span className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900/30 text-green-400 border border-green-800/50">
              {isENS ? 'ENS' : 'Valid'}
            </span>
          </div>

          {/* Text records from ENS profile */}
          {(textRecords.description || textRecords.twitter) && (
            <div className="pt-2 border-t border-gray-700/50 space-y-1">
              {textRecords.description && (
                <p className="text-xs text-gray-400 line-clamp-2">{textRecords.description}</p>
              )}
              {textRecords.twitter && (
                <p className="text-xs text-gray-500">
                  @{textRecords.twitter.replace(/^@/, '')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && isTyping && (
        <p className="text-sm text-red-400">
          Could not resolve this name. Check spelling and try again.
        </p>
      )}

      {/* Hint for unresolved input */}
      {!isValid && !isLoading && isTyping && !error && (
        <p className="text-sm text-gray-500">
          Supports .eth names, DNS names (e.g. name.xyz), and 0x addresses
        </p>
      )}
    </div>
  )
}
