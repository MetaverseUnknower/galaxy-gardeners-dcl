import { getUserData } from '~system/UserIdentity'
import { signedFetch } from '~system/SignedFetch'

const API_BASE = 'http://localhost:3000'

let authToken: string | null = null

export function getToken(): string | null {
  return authToken
}

export async function authenticate(): Promise<{ hasPlayer: boolean }> {
  const response = await getUserData({})
  const userData = response.data

  if (!userData) {
    throw new Error('Could not get player data from Decentraland')
  }

  const walletAddress = userData.publicKey || userData.userId
  const displayName = userData.displayName || 'Explorer'

  const authResponse = await signedFetch({
    url: `${API_BASE}/api/auth/dcl`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, displayName })
    }
  })

  if (!authResponse.ok) {
    throw new Error(`Auth failed: ${authResponse.status} ${authResponse.body}`)
  }

  const data = JSON.parse(authResponse.body)
  authToken = data.accessToken

  return { hasPlayer: data.hasPlayer }
}
