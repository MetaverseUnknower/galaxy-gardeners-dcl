// Stand-in for the explorer's ~system/SignedFetch. Tests replace `handler` to answer requests.
export type FlatFetchResponse = { ok: boolean; status: number; statusText: string; headers: Record<string, string>; body: string }
export let handler: (req: { url: string; init?: any }) => Promise<FlatFetchResponse> = async () => ({
  ok: true, status: 200, statusText: 'OK', headers: {}, body: '{}'
})
export function setSignedFetchHandler(fn: typeof handler): void { handler = fn }
export async function signedFetch(req: { url: string; init?: any }): Promise<FlatFetchResponse> { return handler(req) }
