// LI.FI service — real REST API client (li.quest/v1)

import { lifiClient } from './client'

export const lifi = lifiClient

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
