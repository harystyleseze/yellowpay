// LI.FI service — auto-selects real or mock client based on environment
//
// IS_SANDBOX = true  → mock client (testnet, realistic fake data)
// IS_SANDBOX = false → real client (production, live LI.FI API)

import { IS_SANDBOX } from '@/lib/constants'
import { lifiClient } from './client'
import { lifiMockClient } from './mock'
import type { LiFiService } from './types'

export const lifi: LiFiService = IS_SANDBOX ? lifiMockClient : lifiClient

// Re-export types for convenience
export type {
  LiFiService,
  LiFiQuote,
  LiFiQuoteRequest,
  LiFiChain,
  LiFiToken,
  LiFiStatus,
  LiFiStatusType,
  LiFiSubstatus,
  LiFiTransactionRequest,
  LiFiQuoteEstimate,
  LiFiError,
  LiFiToolError,
} from './types'
