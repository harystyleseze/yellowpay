'use client'

import { useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { PaymentForm } from '@/components/PaymentForm'
import { FundAccount } from '@/components/FundAccount'
import { WithdrawForm } from '@/components/WithdrawForm'
import { TxHistory } from '@/components/TxHistory'

type Tab = 'pay' | 'fund' | 'withdraw' | 'history'

const TAB_CONFIG: Record<Tab, { label: string; title: string; subtitle: string }> = {
  pay: {
    label: 'Pay',
    title: 'Instant Payments',
    subtitle: 'Send payments instantly using ENS or DNS names. No gas fees.',
  },
  fund: {
    label: 'Fund',
    title: 'Fund Account',
    subtitle: 'Deposit any token from any chain into Yellow Network.',
  },
  withdraw: {
    label: 'Withdraw',
    title: 'Withdraw',
    subtitle: 'Withdraw funds from Yellow Network back to your wallet.',
  },
  history: {
    label: 'History',
    title: 'Transaction History',
    subtitle: 'View your payments, deposits, and withdrawals.',
  },
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('pay')
  const { title, subtitle } = TAB_CONFIG[activeTab]

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
          <h2 className="text-3xl font-bold text-white mb-2">{title}</h2>
          <p className="text-gray-400">{subtitle}</p>
        </div>

        {/* Tab navigation */}
        <div className="flex mb-6 bg-gray-900 rounded-lg p-1 border border-gray-800">
          {(Object.keys(TAB_CONFIG) as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === tab
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {TAB_CONFIG[tab].label}
            </button>
          ))}
        </div>

        {activeTab === 'pay' && <PaymentForm />}
        {activeTab === 'fund' && <FundAccount />}
        {activeTab === 'withdraw' && <WithdrawForm />}
        {activeTab === 'history' && <TxHistory />}
      </div>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 border-t border-gray-800 bg-black">
        <div className="max-w-2xl mx-auto px-4 py-3 text-center">
          <p className="text-xs text-gray-500">
            Powered by YellowPay &bull; Yellow Network + ENS + LI.FI
          </p>
        </div>
      </footer>
    </main>
  )
}
