// Mock LI.FI client — used in sandbox/testnet (IS_SANDBOX = true)
// Returns realistic data structures so the UI works identically in both modes.

import type {
  LiFiService,
  LiFiQuoteRequest,
  LiFiQuote,
  LiFiChain,
  LiFiToken,
  LiFiStatus,
} from './types'

// Simulated latency to match real API behavior
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

// --- Mock token data ---

const ETH_TOKEN: LiFiToken = {
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'ETH',
  name: 'Ethereum',
  decimals: 18,
  chainId: 11155111,
  logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
  priceUSD: '2450.00',
}

const USDC_TOKEN: LiFiToken = {
  address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: 11155111,
  logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  priceUSD: '1.00',
}

const USDT_TOKEN: LiFiToken = {
  address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
  symbol: 'USDT',
  name: 'Tether USD',
  decimals: 6,
  chainId: 11155111,
  logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
  priceUSD: '1.00',
}

const DAI_TOKEN: LiFiToken = {
  address: '0x68194a729C2450ad26072b3D33ADaCbcef39D574',
  symbol: 'DAI',
  name: 'Dai Stablecoin',
  decimals: 18,
  chainId: 11155111,
  logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png',
  priceUSD: '1.00',
}

const BASE_SEPOLIA_ETH: LiFiToken = {
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'ETH',
  name: 'Ethereum',
  decimals: 18,
  chainId: 84532,
  logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
  priceUSD: '2450.00',
}

const BASE_SEPOLIA_USDC: LiFiToken = {
  address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: 84532,
  logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  priceUSD: '1.00',
}

const AMOY_MATIC: LiFiToken = {
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'POL',
  name: 'Polygon',
  decimals: 18,
  chainId: 80002,
  logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png',
  priceUSD: '0.45',
}

const AMOY_USDC: LiFiToken = {
  address: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: 80002,
  logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  priceUSD: '1.00',
}

// --- Mock chains ---

const MOCK_CHAINS: LiFiChain[] = [
  {
    id: 11155111,
    key: 'sep',
    name: 'Ethereum Sepolia',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
    nativeToken: ETH_TOKEN,
  },
  {
    id: 84532,
    key: 'bas',
    name: 'Base Sepolia',
    logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/base.svg',
    nativeToken: BASE_SEPOLIA_ETH,
  },
  {
    id: 80002,
    key: 'amo',
    name: 'Polygon Amoy',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png',
    nativeToken: AMOY_MATIC,
  },
]

// --- Mock tokens per chain ---

const MOCK_TOKENS: Record<number, LiFiToken[]> = {
  11155111: [ETH_TOKEN, USDC_TOKEN, USDT_TOKEN, DAI_TOKEN],
  84532: [BASE_SEPOLIA_ETH, BASE_SEPOLIA_USDC],
  80002: [AMOY_MATIC, AMOY_USDC],
}

// --- Helper: calculate mock quote amounts ---

function calculateMockAmounts(
  fromToken: LiFiToken,
  toToken: LiFiToken,
  fromAmount: string,
): { toAmount: string; toAmountMin: string } {
  const fromPrice = parseFloat(fromToken.priceUSD || '1')
  const toPrice = parseFloat(toToken.priceUSD || '1')

  // Convert from smallest unit to human-readable
  const fromHuman = parseFloat(fromAmount) / Math.pow(10, fromToken.decimals)

  // Calculate USD value, then convert to target token
  const usdValue = fromHuman * fromPrice
  const toHuman = usdValue / toPrice

  // Apply a small simulated fee (0.3% swap + 0.1% bridge)
  const fee = 0.004
  const toAfterFee = toHuman * (1 - fee)

  // Convert to smallest unit
  const toAmount = Math.floor(toAfterFee * Math.pow(10, toToken.decimals)).toString()

  // Min amount with 3% slippage
  const toAmountMin = Math.floor(toAfterFee * 0.97 * Math.pow(10, toToken.decimals)).toString()

  return { toAmount, toAmountMin }
}

// --- Mock status tracking ---

const statusTracker = new Map<string, { startTime: number; duration: number }>()

// --- Mock service implementation ---

export const lifiMockClient: LiFiService = {
  async getQuote(params: LiFiQuoteRequest): Promise<LiFiQuote> {
    await delay(600 + Math.random() * 400) // simulate 600-1000ms latency

    // Find tokens
    const chainTokens = MOCK_TOKENS[params.fromChain] || MOCK_TOKENS[11155111]!
    const toChainTokens = MOCK_TOKENS[params.toChain] || MOCK_TOKENS[84532]!

    const fromToken = chainTokens.find(
      t => t.address.toLowerCase() === params.fromToken.toLowerCase()
    ) || chainTokens[0]!

    const toToken = toChainTokens.find(
      t => t.address.toLowerCase() === params.toToken.toLowerCase()
    ) || toChainTokens.find(t => t.symbol === 'USDC') || toChainTokens[0]!

    const { toAmount, toAmountMin } = calculateMockAmounts(fromToken, toToken, params.fromAmount)
    const isCrossChain = params.fromChain !== params.toChain

    return {
      id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: isCrossChain ? 'cross' : 'swap',
      tool: isCrossChain ? 'across' : 'uniswap',
      toolDetails: {
        key: isCrossChain ? 'across' : 'uniswap',
        name: isCrossChain ? 'Across' : 'Uniswap',
        logoURI: isCrossChain
          ? 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/bridges/across.png'
          : 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/exchanges/uniswap.png',
      },
      action: {
        fromChainId: params.fromChain,
        toChainId: params.toChain,
        fromToken: { ...fromToken, chainId: params.fromChain },
        toToken: { ...toToken, chainId: params.toChain },
        fromAmount: params.fromAmount,
        slippage: params.slippage ?? 0.03,
        fromAddress: params.fromAddress,
        toAddress: params.toAddress || params.fromAddress,
      },
      estimate: {
        fromAmount: params.fromAmount,
        toAmount,
        toAmountMin,
        approvalAddress: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // LI.FI diamond address
        feeCosts: [
          {
            name: isCrossChain ? 'Bridge Fee' : 'Swap Fee',
            amount: Math.floor(parseFloat(params.fromAmount) * 0.003).toString(),
            amountUSD: (parseFloat(params.fromAmount) / Math.pow(10, fromToken.decimals) * parseFloat(fromToken.priceUSD || '1') * 0.003).toFixed(2),
            token: fromToken,
          },
        ],
        gasCosts: [
          {
            type: 'SEND',
            amount: isCrossChain ? '250000000000000' : '120000000000000', // 0.00025 or 0.00012 ETH
            amountUSD: isCrossChain ? '0.61' : '0.29',
            token: chainTokens.find(t => t.symbol === 'ETH') || fromToken,
          },
        ],
        executionDuration: isCrossChain ? 120 : 30, // seconds
      },
      transactionRequest: {
        to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
        data: '0xmockdata',
        value: fromToken.address === '0x0000000000000000000000000000000000000000'
          ? params.fromAmount
          : '0',
        gasLimit: isCrossChain ? '350000' : '200000',
        chainId: params.fromChain,
      },
    }
  },

  async getChains(): Promise<LiFiChain[]> {
    await delay(200)
    return MOCK_CHAINS
  },

  async getTokens(chainIds: number[]): Promise<Record<number, LiFiToken[]>> {
    await delay(300)
    const result: Record<number, LiFiToken[]> = {}
    for (const chainId of chainIds) {
      result[chainId] = MOCK_TOKENS[chainId] || []
    }
    return result
  },

  async getStatus(txHash: string, fromChain: number, toChain: number): Promise<LiFiStatus> {
    await delay(300)

    // Track when this tx was first queried to simulate progression
    if (!statusTracker.has(txHash)) {
      const isCrossChain = fromChain !== toChain
      statusTracker.set(txHash, {
        startTime: Date.now(),
        duration: isCrossChain ? 15000 : 5000, // 15s cross-chain, 5s same-chain
      })
    }

    const tracker = statusTracker.get(txHash)!
    const elapsed = Date.now() - tracker.startTime
    const progress = elapsed / tracker.duration

    const fromTokens = MOCK_TOKENS[fromChain] || MOCK_TOKENS[11155111]!
    const toTokens = MOCK_TOKENS[toChain] || MOCK_TOKENS[84532]!

    if (progress < 0.3) {
      return {
        status: 'PENDING',
        substatus: 'WAIT_SOURCE_CONFIRMATIONS',
        substatusMessage: 'Waiting for source chain confirmations',
        fromChain, toChain, txHash,
        sending: { amount: '1000000', token: fromTokens[0]! },
      }
    }

    if (progress < 0.7) {
      return {
        status: 'PENDING',
        substatus: 'WAIT_DESTINATION_TRANSACTION',
        substatusMessage: 'Bridge is processing your transfer',
        fromChain, toChain, txHash,
        sending: { amount: '1000000', token: fromTokens[0]! },
      }
    }

    // Done
    statusTracker.delete(txHash)
    return {
      status: 'DONE',
      substatus: 'COMPLETED',
      substatusMessage: 'Transfer completed successfully',
      fromChain, toChain, txHash,
      sending: { amount: '1000000', token: fromTokens[0]! },
      receiving: { amount: '995000', token: toTokens.find(t => t.symbol === 'USDC') || toTokens[0]! },
    }
  },
}
