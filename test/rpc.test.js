// Tests for the JSON-RPC client: batching, chunking, error slots.
import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeCall, ethCall, padAddress, rpcBatch } from '../src/rpc.js';

test('padAddress left-pads an address to a 32-byte word', () => {
  assert.equal(
    padAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'),
    '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
  );
});

test('encodeCall joins selector and args', () => {
  assert.equal(encodeCall('0x70a08231', padAddress('0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B')), '0x70a08231' + '000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9b');
});

function stubFetch(handler) {
  return async (_url, { body }) => ({
    ok: true,
    json: async () => handler(JSON.parse(body)),
  });
}

test('rpcBatch sends one POST and lines results up with calls', async () => {
  const seen = [];
  const fetchImpl = stubFetch((payload) => {
    seen.push(payload);
    return payload.map((req) => ({ jsonrpc: '2.0', id: req.id, result: `0x${req.id}` }));
  });
  const results = await rpcBatch('https://example.invalid', [
    { method: 'eth_blockNumber', params: [] },
    { method: 'eth_getBalance', params: ['0xabc', 'latest'] },
  ], fetchImpl);
  assert.deepEqual(results, ['0x1', '0x2']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].length, 2);
});

test('rpcBatch chunks large call lists', async () => {
  let calls = 0;
  const fetchImpl = stubFetch((payload) => {
    calls += 1;
    assert.ok(payload.length <= 50);
    return payload.map((req) => ({ jsonrpc: '2.0', id: req.id, result: '0x0' }));
  });
  const results = await rpcBatch('https://example.invalid',
    Array.from({ length: 120 }, (_, i) => ({ method: 'eth_blockNumber', params: [i] })),
    fetchImpl, 50);
  assert.equal(results.length, 120);
  assert.equal(calls, 3);
});

test('rpcBatch puts an Error in the slot of a failed entry, not a throw', async () => {
  const fetchImpl = stubFetch((payload) => payload.map((req) => (
    req.id === 2
      ? { jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'execution reverted' } }
      : { jsonrpc: '2.0', id: req.id, result: '0x1' }
  )));
  const results = await rpcBatch('https://example.invalid', [
    { method: 'eth_blockNumber', params: [] },
    { method: 'eth_call', params: [] },
    { method: 'eth_blockNumber', params: [] },
  ], fetchImpl);
  assert.equal(results[0], '0x1');
  assert.ok(results[1] instanceof Error);
  assert.equal(results[2], '0x1');
});

test('rpcBatch throws on an HTTP error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429 });
  await assert.rejects(
    () => rpcBatch('https://example.invalid', [{ method: 'eth_blockNumber', params: [] }], fetchImpl),
    /HTTP 429/,
  );
});

test('ethCall throws on a JSON-RPC error', async () => {
  const fetchImpl = stubFetch(() => ({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'revert' } }));
  await assert.rejects(
    () => ethCall('https://example.invalid', '0xabc', '0x', 'latest', fetchImpl),
    /revert/,
  );
});
