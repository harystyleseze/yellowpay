// Mock Earn client — used in sandbox/testnet (IS_SANDBOX = true)
// Simulates Aave V3 lending vaults with accelerated yield for demo purposes.

import { IS_SANDBOX } from '@/lib/constants'
import type {
  EarnService,
  EarnVault,
  EarnPosition,
  EarnDepositRequest,
  EarnWithdrawRequest,
} from './types'

// Simulated latency to match real API behavior
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
const randomDelay = () => delay(300 + Math.random() * 900) // 300-1200ms

// --- localStorage persistence ---

const STORAGE_KEY = 'yellowpay_earn_positions'

interface StoredPosition {
  id: string
  vaultId: string
  depositedAmount: number
  depositTimestamp: number
  asset: string
  status: 'active' | 'withdrawn'
}

function readPositions(): StoredPosition[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as StoredPosition[]
  } catch {
    return []
  }
}

function writePositions(positions: StoredPosition[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions))
  } catch {
    // localStorage full or unavailable
  }
}

// --- Mock vault definitions ---

const SANDBOX_ASSET = 'ytest.usd'

const BASE_VAULTS: EarnVault[] = [
  {
    id: 'vault-usdc-lending',
    name: 'USDC Lending',
    protocol: 'Aave V3',
    asset: IS_SANDBOX ? SANDBOX_ASSET : 'usdc',
    apyPercent: 4.5,
    tvlUsd: 245_000_000,
    riskLevel: 'low',
    description: 'Earn yield by lending USDC on Aave V3. Low risk, battle-tested protocol.',
    minDeposit: 1,
  },
  {
    id: 'vault-eth-lending',
    name: 'ETH Lending',
    protocol: 'Aave V3',
    asset: IS_SANDBOX ? SANDBOX_ASSET : 'eth',
    apyPercent: 2.2,
    tvlUsd: 890_000_000,
    riskLevel: 'low',
    description: 'Lend ETH on Aave V3 for conservative yield. Highest TVL, lowest risk.',
    minDeposit: 0.01,
  },
  {
    id: 'vault-usdt-lending',
    name: 'USDT Lending',
    protocol: 'Aave V3',
    asset: IS_SANDBOX ? SANDBOX_ASSET : 'usdt',
    apyPercent: 3.9,
    tvlUsd: 178_000_000,
    riskLevel: 'low',
    description: 'Earn yield by lending USDT on Aave V3. Stablecoin strategy with steady returns.',
    minDeposit: 1,
  },
  {
    id: 'vault-usdc-optimizer',
    name: 'USDC Yield Optimizer',
    protocol: 'Yearn V3',
    asset: IS_SANDBOX ? SANDBOX_ASSET : 'usdc',
    apyPercent: 7.8,
    tvlUsd: 42_000_000,
    riskLevel: 'medium',
    description: 'Auto-compounding USDC strategy across multiple lending markets for higher yield.',
    minDeposit: 10,
  },
  {
    id: 'vault-eth-staking',
    name: 'ETH Liquid Staking',
    protocol: 'Lido + Aave',
    asset: IS_SANDBOX ? SANDBOX_ASSET : 'eth',
    apyPercent: 5.1,
    tvlUsd: 520_000_000,
    riskLevel: 'medium',
    description: 'Stake ETH via Lido and lend stETH on Aave for combined staking + lending yield.',
    minDeposit: 0.1,
  },
]

// --- Yield accrual ---

// In sandbox mode: 1 real minute = 1 simulated day (1440x multiplier)
// This makes yield visible within seconds of depositing
const TIME_MULTIPLIER = IS_SANDBOX ? 1440 : 1

function accrueYield(depositedAmount: number, apyPercent: number, depositTimestamp: number): number {
  const elapsedMs = Date.now() - depositTimestamp
  const elapsedYears = (elapsedMs * TIME_MULTIPLIER) / (365.25 * 24 * 60 * 60 * 1000)

  // Simple interest: amount * apy * time
  const yield_ = depositedAmount * (apyPercent / 100) * elapsedYears

  // Cap at 100% of deposited amount to prevent absurd numbers
  return Math.min(yield_, depositedAmount)
}

// --- APY fluctuation ---

function fluctuateApy(baseApy: number): number {
  const delta = (Math.random() - 0.5) * 0.3 // +/- 0.15%
  return Math.max(0.1, parseFloat((baseApy + delta).toFixed(2)))
}

// --- Hydrate stored position into full EarnPosition ---

function hydratePosition(stored: StoredPosition, vaults: EarnVault[]): EarnPosition {
  const vault = vaults.find(v => v.id === stored.vaultId) || BASE_VAULTS.find(v => v.id === stored.vaultId)!
  const accruedYield = stored.status === 'active'
    ? accrueYield(stored.depositedAmount, vault.apyPercent, stored.depositTimestamp)
    : 0

  return {
    id: stored.id,
    vault,
    depositedAmount: stored.depositedAmount,
    currentAmount: stored.depositedAmount + accruedYield,
    accruedYield,
    depositTimestamp: stored.depositTimestamp,
    asset: stored.asset,
    status: stored.status,
  }
}

// --- Mock service implementation ---

export const earnMockClient: EarnService = {
  async getVaults(): Promise<EarnVault[]> {
    await randomDelay()

    // Return vaults with slight APY fluctuation on each call
    return BASE_VAULTS.map(vault => ({
      ...vault,
      apyPercent: fluctuateApy(vault.apyPercent),
    }))
  },

  async getPositions(): Promise<EarnPosition[]> {
    await randomDelay()

    const stored = readPositions()
    const activePositions = stored.filter(p => p.status === 'active')
    return activePositions.map(p => hydratePosition(p, BASE_VAULTS))
  },

  async deposit(request: EarnDepositRequest): Promise<EarnPosition> {
    await randomDelay()

    const vault = BASE_VAULTS.find(v => v.id === request.vaultId)
    if (!vault) throw new Error('Vault not found')

    if (request.amount < vault.minDeposit) {
      throw new Error(`Minimum deposit is ${vault.minDeposit} ${request.asset}`)
    }

    const stored: StoredPosition = {
      id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      vaultId: vault.id,
      depositedAmount: request.amount,
      depositTimestamp: Date.now(),
      asset: request.asset,
      status: 'active',
    }

    const positions = readPositions()
    positions.unshift(stored)
    writePositions(positions)

    return hydratePosition(stored, BASE_VAULTS)
  },

  async withdraw(request: EarnWithdrawRequest): Promise<EarnPosition> {
    await randomDelay()

    const positions = readPositions()
    const idx = positions.findIndex(p => p.id === request.positionId)
    if (idx === -1) throw new Error('Position not found')

    const stored = positions[idx]!
    // Hydrate to get final yield before marking withdrawn
    const finalPosition = hydratePosition(stored, BASE_VAULTS)

    // Mark as withdrawn
    positions[idx] = { ...stored, status: 'withdrawn' }
    writePositions(positions)

    return { ...finalPosition, status: 'withdrawn' }
  },

  async refreshPosition(positionId: string): Promise<EarnPosition> {
    await delay(100) // Minimal delay for refresh

    const positions = readPositions()
    const stored = positions.find(p => p.id === positionId)
    if (!stored) throw new Error('Position not found')

    return hydratePosition(stored, BASE_VAULTS)
  },
}
