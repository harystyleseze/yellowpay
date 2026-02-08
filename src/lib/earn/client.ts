// Production Earn client — real Aave V3 vault registry with on-chain reads
// Uses viem directly (plain module, not a hook).

import { createPublicClient, http } from 'viem'
import { mainnet, polygon, base } from 'viem/chains'
import { SETTLEMENT_TOKENS } from '@/lib/constants'
import type {
  EarnService,
  EarnVault,
  EarnPosition,
  EarnDepositRequest,
  EarnWithdrawRequest,
} from './types'

// ─── Aave V3 Pool addresses per chain ───

const AAVE_V3_POOLS: Record<number, `0x${string}`> = {
  1:    '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', // Ethereum
  8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', // Base
  137:  '0x794a61358D6845594F94dc1DB02A252b5b4814aD', // Polygon
}

// Chains with Aave V3 support (skip BSC chain 56 — no Aave V3)
const SUPPORTED_CHAIN_IDS = new Set(Object.keys(AAVE_V3_POOLS).map(Number))

// ─── viem public clients per chain ───

const ethClient = createPublicClient({ chain: mainnet, transport: http() })
const polyClient = createPublicClient({ chain: polygon, transport: http() })
const baseClient = createPublicClient({ chain: base, transport: http() })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const publicClients: Record<number, any> = {
  1: ethClient,
  137: polyClient,
  8453: baseClient,
}

// ─── Minimal ABIs ───

// Aave V3 Pool: getReserveData returns a struct — we need:
//   index 0: ReserveConfigurationMap (skip)
//   index 1: liquidityIndex (skip)
//   index 2: currentLiquidityRate (RAY, 10^27)
//   ...
//   index 8: aTokenAddress
const POOL_ABI = [
  {
    name: 'getReserveData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'configuration', type: 'uint256' },
          { name: 'liquidityIndex', type: 'uint128' },
          { name: 'currentLiquidityRate', type: 'uint128' },
          { name: 'variableBorrowIndex', type: 'uint128' },
          { name: 'currentVariableBorrowRate', type: 'uint128' },
          { name: 'currentStableBorrowRate', type: 'uint128' },
          { name: 'lastUpdateTimestamp', type: 'uint40' },
          { name: 'id', type: 'uint16' },
          { name: 'aTokenAddress', type: 'address' },
          { name: 'stableDebtTokenAddress', type: 'address' },
          { name: 'variableDebtTokenAddress', type: 'address' },
          { name: 'interestRateStrategyAddress', type: 'address' },
          { name: 'accruedToTreasury', type: 'uint128' },
          { name: 'unbacked', type: 'uint128' },
          { name: 'isolationModeTotalDebt', type: 'uint128' },
        ],
      },
    ],
  },
] as const

const ERC20_ABI = [
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// ─── RAY to APY conversion ───
// Aave V3 currentLiquidityRate is in RAY format (10^27)
// APY = ((1 + rate/1e27/365)^365 - 1) * 100

const RAY = BigInt(10) ** BigInt(27)

function rayToApy(rateRay: bigint): number {
  const ratePerDay = Number(rateRay) / Number(RAY) / 365
  const apy = (Math.pow(1 + ratePerDay, 365) - 1) * 100
  return Math.round(apy * 100) / 100 // 2 decimal places
}

// ─── Vault cache ───

let cachedVaults: EarnVault[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 60_000 // 60 seconds

// ─── Chain name helper ───

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  137: 'Polygon',
  8453: 'Base',
}

// ─── getVaults — dynamic, reads on-chain ───

async function fetchVaults(): Promise<EarnVault[]> {
  const vaults: EarnVault[] = []

  const entries = Object.entries(SETTLEMENT_TOKENS)

  // Process tokens in parallel
  const results = await Promise.allSettled(
    entries.map(async ([asset, token]) => {
      // Skip native tokens (0x000...0) — can't be supplied to Aave
      if (token.tokenAddress === '0x0000000000000000000000000000000000000000') return null
      // Skip chains without Aave V3
      if (!SUPPORTED_CHAIN_IDS.has(token.chainId)) return null

      const client = publicClients[token.chainId]
      const poolAddress = AAVE_V3_POOLS[token.chainId]
      if (!client || !poolAddress) return null

      try {
        // Call getReserveData on the Aave V3 Pool
        const reserveData = await client.readContract({
          address: poolAddress,
          abi: POOL_ABI,
          functionName: 'getReserveData',
          args: [token.tokenAddress as `0x${string}`],
        })

        const aTokenAddress = reserveData.aTokenAddress as `0x${string}`
        const currentLiquidityRate = reserveData.currentLiquidityRate as bigint

        // Convert rate to APY
        const apyPercent = rayToApy(currentLiquidityRate)

        // Read aToken symbol
        let aTokenSymbol = `a${token.symbol}`
        try {
          aTokenSymbol = await client.readContract({
            address: aTokenAddress,
            abi: ERC20_ABI,
            functionName: 'symbol',
          }) as string
        } catch {
          // Fall back to prefix
        }

        const chainName = CHAIN_NAMES[token.chainId] || `Chain ${token.chainId}`

        const vault: EarnVault = {
          id: `aave-v3-${asset}-${token.chainId}`,
          name: `${aTokenSymbol} Lending`,
          protocol: 'Aave V3',
          asset,
          apyPercent,
          riskLevel: 'low',
          description: `Earn yield by lending ${token.symbol} on Aave V3 (${chainName}). Battle-tested protocol.`,
          minDeposit: 0,
          chainId: token.chainId,
          tokenAddress: token.tokenAddress,
          aTokenAddress,
          tokenDecimals: token.decimals,
        }

        return vault
      } catch {
        // Token is not an Aave V3 reserve — skip silently
        return null
      }
    })
  )

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      vaults.push(result.value)
    }
  }

  return vaults
}

// ─── Exported service ───

export const earnClient: EarnService = {
  async getVaults(): Promise<EarnVault[]> {
    const now = Date.now()
    if (cachedVaults && now - cacheTimestamp < CACHE_TTL) {
      return cachedVaults
    }

    const vaults = await fetchVaults()
    cachedVaults = vaults
    cacheTimestamp = Date.now()
    return vaults
  },

  async getPositions(): Promise<EarnPosition[]> {
    // Positions are read in useEarn hook via on-chain aToken balances
    throw new Error('Use useEarnPositions hook for production position reading')
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deposit(_request: EarnDepositRequest): Promise<EarnPosition> {
    // Deposits handled via LI.FI in EarnDashboard component
    throw new Error('Use LI.FI Composer for production deposits')
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async withdraw(_request: EarnWithdrawRequest): Promise<EarnPosition> {
    // Withdrawals handled via LI.FI in EarnDashboard component
    throw new Error('Use LI.FI Composer for production withdrawals')
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async refreshPosition(_positionId: string): Promise<EarnPosition> {
    throw new Error('Use useEarnPositions hook for production position reading')
  },
}

// ─── Exported utilities for use in hooks ───

export { publicClients, ERC20_ABI }
