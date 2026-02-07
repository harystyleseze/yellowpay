import { useEnsAddress, useEnsName, useEnsText } from 'wagmi'
import { normalize } from 'viem/ens'
import { mainnet } from 'wagmi/chains'
import { isAddress } from 'viem'

// ENS metadata service serves avatar images directly via HTTP.
// Using this as <img src> avoids CORS issues that occur with wagmi's useEnsAvatar
// (which uses fetch() internally to resolve NFT metadata, triggering CORS from euc.li).
const ENS_AVATAR_BASE = 'https://metadata.ens.domains/mainnet/avatar'

// Detect if input looks like an ENS or DNS name
// Per ENS docs: any dot-separated string can resolve via ENS (not just .eth)
// Examples: vitalik.eth, ensfairy.xyz, cb.id, alice.base.eth
function isENSLike(input: string): boolean {
  if (!input || isAddress(input)) return false
  const trimmed = input.trim()
  return trimmed.includes('.') && trimmed.length > 3
}

// Safely normalize an ENS/DNS name via ENSIP-15 (UTS-46)
// Returns undefined if the input is not a valid name
function tryNormalize(input: string): string | undefined {
  if (!isENSLike(input)) return undefined
  try {
    return normalize(input.trim())
  } catch {
    return undefined
  }
}

// Generate avatar URL from ENS name using the metadata service
function avatarUrl(name: string | undefined | null): string | null {
  if (!name) return null
  return `${ENS_AVATAR_BASE}/${name}`
}

// Forward + reverse ENS resolution for recipient input
// Supports .eth names, DNS names (e.g. name.xyz), and raw addresses
// ENS resolution always uses Ethereum mainnet (chainId: 1) per ENS docs
export function useENSResolve(input: string) {
  const isEthAddress = isAddress(input)
  const normalizedName = tryNormalize(input)

  // Forward resolution: ENS/DNS name → address
  const {
    data: resolvedAddress,
    isLoading: isResolvingAddress,
    error: addressError,
  } = useEnsAddress({
    name: normalizedName,
    chainId: mainnet.id,
    query: { enabled: !!normalizedName },
  })

  // Reverse resolution: raw address → primary ENS name
  const { data: reverseName } = useEnsName({
    address: isEthAddress ? (input as `0x${string}`) : undefined,
    chainId: mainnet.id,
    query: { enabled: isEthAddress },
  })

  // Normalize reverse-resolved name for lookups
  const reverseNormalized = reverseName ? tryNormalize(reverseName) : undefined

  const finalAddress = isEthAddress ? (input as `0x${string}`) : resolvedAddress
  const displayName = isEthAddress ? reverseNormalized : normalizedName

  return {
    address: finalAddress ?? null,
    name: displayName ?? null,
    avatar: avatarUrl(displayName),
    isLoading: !isEthAddress && isResolvingAddress,
    isValid: !!finalAddress,
    isENS: (!isEthAddress && !!resolvedAddress) || (isEthAddress && !!reverseName),
    error: addressError,
  }
}

// Reverse lookup: address → primary ENS name
export function useENSName(address: `0x${string}` | undefined) {
  const { data: ensName } = useEnsName({
    address,
    chainId: mainnet.id,
    query: { enabled: !!address },
  })
  return ensName ?? null
}

// Full ENS profile for a wallet address: reverse name, avatar, and text records
// Used for displaying the connected user's identity
export function useENSProfile(address: `0x${string}` | undefined) {
  // Reverse: address → primary name
  const { data: name } = useEnsName({
    address,
    chainId: mainnet.id,
    query: { enabled: !!address },
  })

  const normalizedName = name ? tryNormalize(name) : undefined

  // Text records
  const { data: description } = useEnsText({
    name: normalizedName,
    key: 'description',
    chainId: mainnet.id,
    query: { enabled: !!normalizedName },
  })

  const { data: twitter } = useEnsText({
    name: normalizedName,
    key: 'com.twitter',
    chainId: mainnet.id,
    query: { enabled: !!normalizedName },
  })

  const { data: github } = useEnsText({
    name: normalizedName,
    key: 'com.github',
    chainId: mainnet.id,
    query: { enabled: !!normalizedName },
  })

  const { data: url } = useEnsText({
    name: normalizedName,
    key: 'url',
    chainId: mainnet.id,
    query: { enabled: !!normalizedName },
  })

  return {
    name: name ?? null,
    avatar: avatarUrl(normalizedName),
    description: description ?? null,
    twitter: twitter ?? null,
    github: github ?? null,
    url: url ?? null,
    hasProfile: !!name,
  }
}

// Text records for a resolved ENS name (used for recipient display)
export function useENSTextRecords(name: string | null) {
  const normalizedName = name ? tryNormalize(name) : undefined

  const { data: description } = useEnsText({
    name: normalizedName,
    key: 'description',
    chainId: mainnet.id,
    query: { enabled: !!normalizedName },
  })

  const { data: twitter } = useEnsText({
    name: normalizedName,
    key: 'com.twitter',
    chainId: mainnet.id,
    query: { enabled: !!normalizedName },
  })

  return {
    description: description ?? null,
    twitter: twitter ?? null,
  }
}
