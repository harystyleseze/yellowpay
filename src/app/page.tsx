'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { PaymentForm } from '@/components/PaymentForm'

export default function Home() {
  return (
    <main className="min-h-screen bg-black">
      {/* Header */}
      <header className="border-b border-gray-800">
        <div className="max-w-2xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-white">
            Yellow<span className="text-yellow-400">Pay</span>
          </h1>
          <ConnectButton />
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-white mb-2">
            Instant Payments
          </h2>
          <p className="text-gray-400">
            Send USDC instantly using ENS names. No gas fees.
          </p>
        </div>

        <PaymentForm />
      </div>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 border-t border-gray-800 bg-black">
        <div className="max-w-2xl mx-auto px-4 py-3 text-center">
          <p className="text-xs text-gray-500">
            Built for HackMoney 2026 • Yellow Network + ENS
          </p>
        </div>
      </footer>
    </main>
  )
}
