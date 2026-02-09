import { type PublicClient, type WalletClient, type Address, erc20Abi } from 'viem'

const NATIVE = '0x0000000000000000000000000000000000000000'

export async function ensureApproval(
  walletClient: WalletClient,
  publicClient: PublicClient,
  params: { token: Address; owner: Address; spender: Address; amount: bigint },
): Promise<void> {
  if (params.token.toLowerCase() === NATIVE) return

  const allowance = await publicClient.readContract({
    address: params.token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [params.owner, params.spender],
  })

  if (allowance >= params.amount) return

  const [account] = await walletClient.getAddresses()
  const hash = await walletClient.writeContract({
    address: params.token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [params.spender, params.amount],
    chain: walletClient.chain,
    account: account!,
  })

  await publicClient.waitForTransactionReceipt({ hash })
}
