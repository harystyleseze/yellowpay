'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { QRCodeSVG } from 'qrcode.react'
import { PRODUCTION_ASSETS, getAssetLabel } from '@/lib/constants'

const REQUESTABLE_ASSETS = Object.keys(PRODUCTION_ASSETS).filter(
  k => ['usdc', 'usdt', 'eth'].includes(k),
)

export function RequestPayment() {
  const { address } = useAccount()
  const [amount, setAmount] = useState('')
  const [asset, setAsset] = useState('usdc')
  const [copied, setCopied] = useState(false)
  const qrRef = useRef<HTMLDivElement>(null)

  const paymentUrl = useMemo(() => {
    if (!address) return ''
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const params = new URLSearchParams()
    params.set('to', address)
    if (amount && parseFloat(amount) > 0) params.set('amount', amount)
    if (asset !== 'usdc') params.set('asset', asset)
    return `${origin}/?${params.toString()}`
  }, [address, amount, asset])

  const handleDownloadQR = useCallback(() => {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return

    const svgData = new XMLSerializer().serializeToString(svg)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const padding = 48
    const size = 200 + padding
    canvas.width = size
    canvas.height = size

    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(img, padding / 2, padding / 2, 200, 200)

      const link = document.createElement('a')
      link.download = 'yellowpay-qr.jpg'
      link.href = canvas.toDataURL('image/jpeg', 0.95)
      link.click()
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
  }, [])

  const handleCopy = async () => {
    if (!paymentUrl) return
    await navigator.clipboard.writeText(paymentUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!address) {
    return (
      <div className="text-center py-6">
        <p className="text-gray-400 text-sm">Connect your wallet to request payments</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* QR Code */}
      {paymentUrl && (
        <div className="flex justify-center">
          <div className="relative bg-white rounded-lg p-6" ref={qrRef}>
            <QRCodeSVG value={paymentUrl} size={200} />
            <button
              onClick={handleDownloadQR}
              title="Download QR code"
              className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full
                         bg-gray-200 hover:bg-gray-300 flex items-center justify-center
                         transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Amount input (optional) */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">Amount (optional)</label>
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
                       focus:ring-yellow-500 focus:border-transparent pr-24"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
            {getAssetLabel(asset)}
          </span>
        </div>
      </div>

      {/* Asset selector */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">Asset</label>
        <select
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
          className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg
                     text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500
                     focus:border-transparent appearance-none cursor-pointer"
        >
          {REQUESTABLE_ASSETS.map(key => (
            <option key={key} value={key}>{getAssetLabel(key)}</option>
          ))}
        </select>
      </div>

      {/* Copy button */}
      <button
        onClick={handleCopy}
        className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-black
                   font-medium rounded-lg transition-colors flex items-center
                   justify-center gap-2"
      >
        {copied ? (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Copied!
          </>
        ) : (
          'Copy Payment Link'
        )}
      </button>

      {/* URL preview */}
      {paymentUrl && (
        <p className="text-xs text-gray-500 break-all text-center">{paymentUrl}</p>
      )}

      <p className="text-xs text-gray-500 text-center">
        Share this link or QR code to receive payments
      </p>
    </div>
  )
}
