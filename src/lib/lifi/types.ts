// LI.FI service types

export interface LiFiToken {
  address: string
  symbol: string
  name: string
  decimals: number
  chainId: number
  logoURI?: string
  priceUSD?: string
}

export interface LiFiChain {
  id: number
  key: string
  name: string
  logoURI?: string
  nativeToken: LiFiToken
}

export interface LiFiQuoteRequest {
  fromChain: number
  toChain: number
  fromToken: string    // token address
  toToken: string      // token address
  fromAmount: string   // in smallest unit (wei, etc.)
  fromAddress: string
  toAddress?: string   // defaults to fromAddress
  slippage?: number    // 0.01 = 1%, default 0.03
}

export interface LiFiTransactionRequest {
  to: string
  data: string
  value: string
  gasLimit: string
  gasPrice?: string
  chainId: number
}

export interface LiFiQuoteEstimate {
  fromAmount: string
  toAmount: string
  toAmountMin: string
  approvalAddress: string
  feeCosts: Array<{
    name: string
    amount: string
    amountUSD: string
    token: LiFiToken
  }>
  gasCosts: Array<{
    type: string
    amount: string
    amountUSD: string
    token: LiFiToken
  }>
  executionDuration: number  // seconds
}

export interface LiFiQuote {
  id: string
  type: string           // 'lifi' | 'swap' | 'cross'
  tool: string           // e.g., 'uniswap', 'across', 'stargate'
  toolDetails: {
    key: string
    name: string
    logoURI: string
  }
  action: {
    fromChainId: number
    toChainId: number
    fromToken: LiFiToken
    toToken: LiFiToken
    fromAmount: string
    slippage: number
    fromAddress: string
    toAddress: string
  }
  estimate: LiFiQuoteEstimate
  transactionRequest: LiFiTransactionRequest
}

export type LiFiStatusType = 'NOT_FOUND' | 'INVALID' | 'PENDING' | 'DONE' | 'FAILED'

export type LiFiSubstatus =
  | 'WAIT_SOURCE_CONFIRMATIONS'
  | 'WAIT_DESTINATION_TRANSACTION'
  | 'BRIDGE_NOT_AVAILABLE'
  | 'CHAIN_NOT_AVAILABLE'
  | 'NOT_PROCESSABLE_REFUND_NEEDED'
  | 'UNKNOWN_ERROR'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'REFUNDED'

export interface LiFiStatus {
  status: LiFiStatusType
  substatus?: LiFiSubstatus
  substatusMessage?: string
  fromChain: number
  toChain: number
  txHash: string
  bridgeExplorerLink?: string
  sending?: { amount: string; token: LiFiToken }
  receiving?: { amount: string; token: LiFiToken }
}

export interface LiFiToolError {
  errorType: string
  code: string
  tool: string
  message: string
}

export interface LiFiError {
  message: string
  code?: number
  errors?: LiFiToolError[]
}

// The service interface
export interface LiFiService {
  getQuote(params: LiFiQuoteRequest): Promise<LiFiQuote>
  getChains(): Promise<LiFiChain[]>
  getTokens(chainIds: number[]): Promise<Record<number, LiFiToken[]>>
  getStatus(txHash: string, fromChain: number, toChain: number, bridge?: string): Promise<LiFiStatus>
}
