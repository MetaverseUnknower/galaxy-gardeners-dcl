// Stand-in for the explorer's ~system/UserIdentity.
export async function getUserData(_req: any): Promise<any> {
  return { data: { displayName: 'Test Captain', publicKey: '0xtest', userId: '0xtest', hasConnectedWeb3: true } }
}
