// Chain IDs
export const ARBITRUM_CHAIN_ID = 42161
export const ETHEREUM_CHAIN_ID = 1

// USDC on Arbitrum (native USDC, not bridged)
export const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const

// USDC decimals
export const USDC_DECIMALS = 6

// Yellow Network WebSocket endpoint (Sandbox for testing)
export const YELLOW_WS_ENDPOINT = process.env.NEXT_PUBLIC_YELLOW_WS || 'wss://clearnet-sandbox.yellow.com/ws'
