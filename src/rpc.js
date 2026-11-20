// Minimal JSON-RPC client over fetch. No dependencies.
//
// Reads are done as one batched POST wherever possible: a sweep checks
// ~10 tokens x ~9 spenders, and 90 sequential round-trips would make the
// CLI unusable on a slow RPC. Batches are chunked so a single request
// stays small enough for public RPCs to accept.

export class RpcError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RpcError';
  }
}

function toHexQuantity(value) {
  return '0x' + value.toString(16);
}

export function padAddress(address) {
  return '0x' + '000000000000000000000000' + address.toLowerCase().replace(/^0x/, '');
}

export function encodeCall(selector, ...args) {
  return selector + args.map((a) => a.replace(/^0x/, '')).join('');
}

// One eth_call, returned as raw hex (or null on an empty response).
export async function ethCall(rpcUrl, to, data, block = 'latest', fetchImpl = fetch) {
  const res = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to, data }, block],
    }),
  });
  if (!res.ok) throw new RpcError(`RPC HTTP ${res.status} from ${rpcUrl}`);
  const json = await res.json();
  if (json.error) throw new RpcError(`RPC error ${json.error.code}: ${json.error.message}`);
  return json.result ?? null;
}

// Batch of calls in one POST. Each entry is { method, params } and the
// returned array lines up with the input order; a failed entry yields an
// Error object in its slot instead of throwing, so one bad read does not
// sink the whole sweep. HTTP 429/5xx responses are retried with backoff
// (public RPCs rate-limit bursts); chunk size is kept small for the same
// reason.
export async function rpcBatch(rpcUrl, calls, fetchImpl = fetch, chunkSize = 25) {
  const results = [];
  for (let i = 0; i < calls.length; i += chunkSize) {
    const chunk = calls.slice(i, i + chunkSize);
    const payload = chunk.map((c, j) => ({
      jsonrpc: '2.0',
      id: i + j + 1,
      method: c.method,
      params: c.params,
    }));
    let res;
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      res = await fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) break;
      lastError = new RpcError(`RPC HTTP ${res.status} from ${rpcUrl}`);
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
    if (!res.ok) throw lastError;
    const json = await res.json();
    const byId = new Map();
    for (const item of Array.isArray(json) ? json : [json]) byId.set(item.id, item);
    for (let j = 0; j < chunk.length; j += 1) {
      const item = byId.get(i + j + 1);
      if (!item) results.push(new Error('missing batch response'));
      else if (item.error) results.push(new RpcError(`RPC error ${item.error.code}: ${item.error.message}`));
      else results.push(item.result ?? null);
    }
  }
  return results;
}

export async function getCode(rpcUrl, address, block = 'latest', fetchImpl = fetch) {
  const [code] = await rpcBatch(rpcUrl, [
    { method: 'eth_getCode', params: [address, block] },
  ], fetchImpl);
  if (code instanceof Error) throw code;
  return code;
}

export async function getBalance(rpcUrl, address, block = 'latest', fetchImpl = fetch) {
  const [balance] = await rpcBatch(rpcUrl, [
    { method: 'eth_getBalance', params: [address, block] },
  ], fetchImpl);
  if (balance instanceof Error) throw balance;
  return balance;
}

export async function getBlockNumber(rpcUrl, fetchImpl = fetch) {
  const [block] = await rpcBatch(rpcUrl, [
    { method: 'eth_blockNumber', params: [] },
  ], fetchImpl);
  if (block instanceof Error) throw block;
  return block;
}

export { toHexQuantity };
