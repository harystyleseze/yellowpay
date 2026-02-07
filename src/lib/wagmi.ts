import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, base, polygon, bsc, linea, baseSepolia, polygonAmoy, sepolia } from 'wagmi/chains'
import { http, fallback } from 'viem'

// Yellow Network supported chains:
// Sandbox: Base Sepolia, Polygon Amoy, Ethereum Sepolia
// Production: Ethereum, Base, Polygon, BNB Smart Chain, Linea, World Chain, XRPL EVM
// Mainnet always included for ENS resolution

export const config = getDefaultConfig({
  appName: 'YellowPay',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '',
  chains: [
    mainnet,       // ENS resolution + Yellow production
    base,          // Yellow production
    polygon,       // Yellow production
    bsc,           // Yellow production
    linea,         // Yellow production
    baseSepolia,   // Yellow sandbox
    polygonAmoy,   // Yellow sandbox
    sepolia,       // Yellow sandbox
  ],
  transports: {
    // Mainnet: fallback across multiple CORS-friendly RPCs for reliable ENS resolution
    [mainnet.id]: fallback([
      http('https://ethereum-rpc.publicnode.com'),
      http('https://eth.llamarpc.com'),
    ]),
    [base.id]: http(),
    [polygon.id]: http(),
    [bsc.id]: http(),
    [linea.id]: http(),
    [baseSepolia.id]: http(),
    [polygonAmoy.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: true, // Required for Next.js App Router
})
