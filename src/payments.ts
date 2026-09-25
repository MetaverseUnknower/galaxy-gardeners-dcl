// MANA payments on Polygon: the player's wallet sends an ERC-20 transfer to the game wallet, and the API
// only credits fuel cells after it has verified that transaction on chain (see the server's store route).
import { createEthereumProvider } from '@dcl/sdk/ethereum-provider'
import { getPlayer } from '@dcl/sdk/players'
import * as api from './api'

export const POLYGON_CHAIN_ID = '0x89'
export const POLYGON_MANA = '0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4'
export const MANA_BENEFICIARY = '0x7e567DEaBFFCeCEea48dA456EBb9Ef84d159374C'   // MetaPetal, owner of metapetal.dcl.eth

const TRANSFER_SELECTOR = '0xa9059cbb'   // transfer(address,uint256)
const CONFIRM_POLL_MS = 3000
const CONFIRM_MAX_POLLS = 60             // three minutes, plenty for Polygon

let provider: ReturnType<typeof createEthereumProvider> | null = null
let rpcId = 1

function rpc(method: string, params: unknown[]): Promise<any> {
  if (!provider) provider = createEthereumProvider()
  return new Promise((resolve, reject) => {
    provider!.sendAsync({ id: rpcId++, jsonrpc: '2.0', method, params }, (err, result) => {
      if (err) { reject(err); return }
      if (result && typeof result === 'object' && 'error' in result && result.error) { reject(new Error(result.error.message ?? 'Wallet request failed')); return }
      resolve(result && typeof result === 'object' && 'result' in result ? result.result : result)
    })
  })
}

const pad32 = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')

/** Asks the wallet to send `mana` MANA on Polygon to the game wallet. Resolves with the transaction hash. */
export async function payMana(mana: number): Promise<string> {
  const from = getPlayer()?.userId
  if (!from || !/^0x[0-9a-fA-F]{40}$/.test(from)) throw new Error('Connect a wallet to buy with MANA')

  try { await rpc('wallet_switchEthereumChain', [{ chainId: POLYGON_CHAIN_ID }]) } catch { /* wallet may already be on Polygon or refuse; the server rejects wrong-chain payments */ }

  const wei = BigInt(Math.round(mana * 1000)) * 10n ** 15n
  const data = TRANSFER_SELECTOR + pad32(MANA_BENEFICIARY) + pad32(wei.toString(16))
  const hash = await rpc('eth_sendTransaction', [{ from, to: POLYGON_MANA, data, value: '0x0' }])
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Wallet did not return a transaction hash')
  return hash
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** Redeems a payment with the API, retrying while Polygon has not confirmed the transaction yet. */
export async function redeemManaPurchase(tier: string, txHash: string, onPending?: (attempt: number) => void): Promise<{ fuelCells: number }> {
  for (let attempt = 1; attempt <= CONFIRM_MAX_POLLS; attempt++) {
    const result = await api.purchaseFuelCellsMana(tier, txHash)
    if (result.status === 'ok' && typeof result.fuelCells === 'number') return { fuelCells: result.fuelCells }
    onPending?.(attempt)
    await delay(CONFIRM_POLL_MS)
  }
  throw new Error(`Still waiting on Polygon. Keep this hash to redeem later: ${txHash}`)
}

/** Turns an API error ("API error 402: {"error":"..."}") into the server's message. */
export function paymentErrorMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  const m = /^API error \d+: (.*)$/s.exec(msg)
  if (m) { try { return JSON.parse(m[1]).error ?? fallback } catch { return fallback } }
  if (/reject|denied|cancel/i.test(msg)) return 'Payment cancelled'
  return msg || fallback
}
