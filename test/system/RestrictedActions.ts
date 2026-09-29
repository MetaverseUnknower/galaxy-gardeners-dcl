// Stand-in for the explorer's ~system/RestrictedActions: records each call so tests can check them.
export const calls: { name: string; args: any }[] = []
const record = (name: string) => async (args: any) => { calls.push({ name, args }); return {} }
export const movePlayerTo = record('movePlayerTo')
export const teleportTo = record('teleportTo')
export const changeRealm = record('changeRealm')
export const openExternalUrl = record('openExternalUrl')
