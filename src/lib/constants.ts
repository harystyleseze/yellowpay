// Yellow Network WebSocket endpoints
export const YELLOW_WS_ENDPOINT = process.env.NEXT_PUBLIC_YELLOW_WS || 'wss://clearnet-sandbox.yellow.com/ws'

// Determine environment from WebSocket endpoint
export const IS_SANDBOX = YELLOW_WS_ENDPOINT.includes('sandbox')

// ─── Sandbox (Testnet) Chains ───
// Source: https://docs.yellow.org/docs/learn/introduction/supported-chains
export const SANDBOX_CHAINS = {
  BASE_SEPOLIA: { chainId: 84532, name: 'Base Sepolia' },
  POLYGON_AMOY: { chainId: 80002, name: 'Polygon Amoy' },
  ETHEREUM_SEPOLIA: { chainId: 11155111, name: 'Ethereum Sepolia' },
} as const

// ─── Production (Mainnet) Chains ───
export const PRODUCTION_CHAINS = {
  ETHEREUM: { chainId: 1, name: 'Ethereum' },
  BNB: { chainId: 56, name: 'BNB Smart Chain' },
  POLYGON: { chainId: 137, name: 'Polygon' },
  WORLD_CHAIN: { chainId: 480, name: 'World Chain' },
  BASE: { chainId: 8453, name: 'Base' },
  LINEA: { chainId: 59144, name: 'Linea' },
  XRPL_EVM: { chainId: 1440000, name: 'XRPL EVM Sidechain' },
} as const

// ─── Custody & Adjudicator Contracts ───
// Sandbox (same addresses across testnet chains)
export const SANDBOX_CONTRACTS = {
  custody: '0x019B65A265EB3363822f2752141b3dF16131b262' as const,
  adjudicator: '0x7c7ccbc98469190849BCC6c926307794fDfB11F2' as const,
}

// Production (two sets of contracts)
export const PRODUCTION_CONTRACTS = {
  // Set A: Ethereum, BNB, World Chain, Linea, XRPL EVM
  SET_A: {
    custody: '0x6F71a38d919ad713D0AfE0eB712b95064Fc2616f' as const,
    adjudicator: '0x14980dF216722f14c42CA7357b06dEa7eB408b10' as const,
  },
  // Set B: Polygon, Base
  SET_B: {
    custody: '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6' as const,
    adjudicator: '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C' as const,
  },
} as const

// ─── Assets ───
// Sandbox: only test token
export const SANDBOX_ASSET = 'ytest.usd'

// Production assets with decimals
export const PRODUCTION_ASSETS = {
  usdc: { symbol: 'usdc', decimals: 6, label: 'USDC' },
  usdt: { symbol: 'usdt', decimals: 6, label: 'USDT' },
  eth: { symbol: 'eth', decimals: 18, label: 'ETH' },
  weth: { symbol: 'weth', decimals: 18, label: 'WETH' },
  bnb: { symbol: 'bnb', decimals: 18, label: 'BNB' },
  link: { symbol: 'link', decimals: 18, label: 'LINK' },
  xrp: { symbol: 'xrp', decimals: 18, label: 'XRP' },
  beatwav: { symbol: 'beatwav', decimals: 18, label: 'Beatwav' },
} as const

// Default asset for the current environment
export const DEFAULT_ASSET = IS_SANDBOX ? SANDBOX_ASSET : 'usdc'
export const DEFAULT_ASSET_LABEL = IS_SANDBOX ? 'ytest.usd' : 'USDC'

// Get display label for any Yellow Network asset
export function getAssetLabel(asset: string): string {
  if (IS_SANDBOX) return asset // e.g. 'ytest.usd'
  const entry = PRODUCTION_ASSETS[asset as keyof typeof PRODUCTION_ASSETS]
  return entry?.label || asset.toUpperCase()
}

// Get custody/adjudicator contract addresses for a given chain ID
export function getContractsForChain(chainId: number): { custody: `0x${string}`; adjudicator: `0x${string}` } {
  if (IS_SANDBOX) {
    return SANDBOX_CONTRACTS
  }

  // Production: Polygon (137) and Base (8453) use Set B, all others use Set A
  const SET_B_CHAINS = [137, 8453]
  if (SET_B_CHAINS.includes(chainId)) {
    return PRODUCTION_CONTRACTS.SET_B
  }
  return PRODUCTION_CONTRACTS.SET_A
}

// Ethereum mainnet chain ID (for ENS resolution)
export const ETHEREUM_CHAIN_ID = 1

// ─── Settlement Token Mapping ───
// Maps Yellow Network asset names to on-chain tokens for LI.FI routing.
// When paying with "any token", LI.FI swaps/bridges to this token on this chain,
// then it gets deposited into Yellow Network custody.
interface SettlementToken {
  chainId: number
  tokenAddress: string
  decimals: number
  symbol: string
}

export const SETTLEMENT_TOKENS: Record<string, SettlementToken> = {
  usdc: { chainId: 8453, tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, symbol: 'USDC' },
  usdt: { chainId: 137, tokenAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, symbol: 'USDT' },
  eth:  { chainId: 8453, tokenAddress: '0x0000000000000000000000000000000000000000', decimals: 18, symbol: 'ETH' },
  weth: { chainId: 8453, tokenAddress: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' },
  bnb:  { chainId: 56, tokenAddress: '0x0000000000000000000000000000000000000000', decimals: 18, symbol: 'BNB' },
  link: { chainId: 8453, tokenAddress: '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196', decimals: 18, symbol: 'LINK' },
}

// Get the settlement token config for a Yellow Network asset
export function getSettlementToken(asset: string): SettlementToken {
  const token = SETTLEMENT_TOKENS[asset.toLowerCase()]
  // Default to USDC on Base
  return token || SETTLEMENT_TOKENS.usdc
}
