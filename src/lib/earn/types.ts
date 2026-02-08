// Earn service types

export type RiskLevel = 'low' | 'medium' | 'high'

export interface EarnVault {
  id: string
  name: string
  protocol: string
  asset: string // Yellow Network asset (e.g. 'ytest.usd', 'usdc')
  apyPercent: number
  tvlUsd?: number
  riskLevel: RiskLevel
  description: string
  minDeposit: number
  // On-chain fields — optional, populated when vault is discovered from Aave V3 reserves
  chainId?: number         // chain where the vault lives (1, 137, 8453)
  tokenAddress?: string    // underlying token address (e.g., USDC on Base)
  aTokenAddress?: string   // Aave aToken (LI.FI toToken for deposits, balanceOf for positions)
  tokenDecimals?: number   // for parsing amounts
}

export type PositionStatus = 'active' | 'withdrawn'

export interface EarnPosition {
  id: string
  vault: EarnVault
  depositedAmount: number
  currentAmount: number
  accruedYield: number
  depositTimestamp: number // Unix ms
  asset: string
  status: PositionStatus
}

export interface EarnDepositRequest {
  vaultId: string
  amount: number
  asset: string
}

export interface EarnWithdrawRequest {
  positionId: string
}

export interface EarnService {
  getVaults(): Promise<EarnVault[]>
  getPositions(): Promise<EarnPosition[]>
  deposit(request: EarnDepositRequest): Promise<EarnPosition>
  withdraw(request: EarnWithdrawRequest): Promise<EarnPosition>
  refreshPosition(positionId: string): Promise<EarnPosition>
}
