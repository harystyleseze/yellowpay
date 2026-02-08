// Earn service — production Aave V3 client via LI.FI

import { earnClient } from './client'
import type { EarnService } from './types'

export const earn: EarnService = earnClient

// Re-export types for convenience
export type {
  EarnService,
  EarnVault,
  EarnPosition,
  EarnDepositRequest,
  EarnWithdrawRequest,
  RiskLevel,
  PositionStatus,
} from './types'
