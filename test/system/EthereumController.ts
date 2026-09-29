// Stand-in for the explorer's ~system/EthereumController (the SDK's wallet provider imports it).
export async function sendAsync(_req: any): Promise<any> { return { jsonAnyResponse: '{}' } }
export async function requirePayment(_req: any): Promise<any> { return {} }
export async function signMessage(_req: any): Promise<any> { return {} }
export async function convertMessageToObject(_req: any): Promise<any> { return {} }
export async function getUserAccount(_req: any): Promise<any> { return { address: '0xtest' } }
export async function send(_req: any): Promise<any> { return {} }
