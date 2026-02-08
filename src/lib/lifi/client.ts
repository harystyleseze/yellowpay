// LI.FI REST API client (li.quest/v1)

import type {
  LiFiService,
  LiFiQuoteRequest,
  LiFiQuote,
  LiFiChain,
  LiFiToken,
  LiFiStatus,
  LiFiError,
} from './types'

const BASE_URL = 'https://li.quest/v1'

class LiFiApiError extends Error {
  code?: number
  errors?: LiFiError['errors']

  constructor(err: LiFiError) {
    super(err.message)
    this.name = 'LiFiApiError'
    this.code = err.code
    this.errors = err.errors
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  }

  // Add API key if available (server-side only via Next.js env)
  const apiKey = process.env.NEXT_PUBLIC_LIFI_API_KEY
  if (apiKey) {
    headers['x-lifi-api-key'] = apiKey
  }

  const res = await fetch(url, { ...options, headers })

  if (!res.ok) {
    let errorBody: LiFiError
    try {
      errorBody = await res.json()
    } catch {
      errorBody = { message: `HTTP ${res.status}: ${res.statusText}` }
    }
    throw new LiFiApiError(errorBody)
  }

  return res.json()
}

export const lifiClient: LiFiService = {
  async getQuote(params: LiFiQuoteRequest): Promise<LiFiQuote> {
    const searchParams = new URLSearchParams({
      fromChain: params.fromChain.toString(),
      toChain: params.toChain.toString(),
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.fromAmount,
      fromAddress: params.fromAddress,
      slippage: (params.slippage ?? 0.03).toString(),
    })

    if (params.toAddress) {
      searchParams.set('toAddress', params.toAddress)
    }

    return apiFetch<LiFiQuote>(`/quote?${searchParams}`)
  },

  async getChains(): Promise<LiFiChain[]> {
    const data = await apiFetch<{ chains: LiFiChain[] }>('/chains')
    return data.chains
  },

  async getTokens(chainIds: number[]): Promise<Record<number, LiFiToken[]>> {
    const data = await apiFetch<{ tokens: Record<string, LiFiToken[]> }>(
      `/tokens?chains=${chainIds.join(',')}`
    )
    // API returns string keys, convert to number keys
    const result: Record<number, LiFiToken[]> = {}
    for (const [chainId, tokens] of Object.entries(data.tokens)) {
      result[Number(chainId)] = tokens
    }
    return result
  },

  async getStatus(
    txHash: string,
    fromChain: number,
    toChain: number,
    bridge?: string,
  ): Promise<LiFiStatus> {
    const searchParams = new URLSearchParams({
      txHash,
      fromChain: fromChain.toString(),
      toChain: toChain.toString(),
    })
    if (bridge) {
      searchParams.set('bridge', bridge)
    }
    return apiFetch<LiFiStatus>(`/status?${searchParams}`)
  },
}
