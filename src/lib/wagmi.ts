import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { arbitrum, mainnet } from 'wagmi/chains'

export const config = getDefaultConfig({
  appName: 'YellowPay',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '',
  chains: [arbitrum, mainnet], // Arbitrum for payments, Mainnet for ENS
  ssr: true, // Required for Next.js App Router
})
