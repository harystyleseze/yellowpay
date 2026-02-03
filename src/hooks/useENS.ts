import { useEnsAddress, useEnsName, useEnsAvatar } from 'wagmi'
import { normalize } from 'viem/ens'
import { mainnet } from 'wagmi/chains'
import { isAddress } from 'viem'

export function useENSResolve(input: string) {
  // Check if input is already an address
  const isEthAddress = isAddress(input)

  // Normalize ENS name (only if not an address)
  let normalizedName: string | undefined
  try {
    normalizedName = !isEthAddress && input ? normalize(input) : undefined
  } catch {
    // Invalid ENS name format
    normalizedName = undefined
  }

  // Resolve ENS name to address
  const {
    data: resolvedAddress,
    isLoading: isResolvingAddress,
    error: addressError
  } = useEnsAddress({
    name: normalizedName,
    chainId: mainnet.id, // ENS resolution always from mainnet
    query: {
      enabled: !!normalizedName, // Only query if we have a valid name
    }
  })

  // Get avatar for the name
  const { data: avatar } = useEnsAvatar({
    name: normalizedName,
    chainId: mainnet.id,
    query: {
      enabled: !!normalizedName,
    }
  })

  // If input is an address, use it directly
  const finalAddress = isEthAddress ? input as `0x${string}` : resolvedAddress

  return {
    address: finalAddress,
    avatar,
    isLoading: isResolvingAddress,
    isValid: !!finalAddress,
    isENS: !isEthAddress && !!resolvedAddress,
    error: addressError,
  }
}

// Reverse lookup: address to ENS name
export function useENSName(address: `0x${string}` | undefined) {
  const { data: ensName } = useEnsName({
    address,
    chainId: mainnet.id,
    query: {
      enabled: !!address,
    }
  })

  return ensName
}
