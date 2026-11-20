// Tests for the report renderers and CLI argument parsing.
import assert from 'node:assert/strict';
import test from 'node:test';

import { main, parseArgs, usage } from '../src/cli.js';
import { renderJson, renderText } from '../src/report.js';

const BASE_REPORT = {
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  chain: 'bsc',
  chainId: 56,
  chainName: 'BNB Smart Chain',
  rpc: 'https://bsc-rpc.publicnode.com',
  blockNumber: '123456',
  nativeBalance: '2000000000000000000',
  nativeBalanceFormatted: '2',
  nativeSymbol: 'BNB',
  explorer: 'https://bscscan.com',
  delegated: null,
  isContract: false,
  balances: [
    { token: { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18 }, balance: '100000000000000000000', balanceFormatted: '100' },
  ],
  allowances: [],
  findings: [
    {
      severity: 'high',
      code: 'UNLIMITED_ALLOWANCE',
      title: 'Unlimited USDT allowance to Uniswap Permit2',
      detail: 'Permit2 can pull any amount with a valid signature.',
      token: { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18 },
      spender: { address: '0x000000000022D473030F116dDEE9F6B43aC78BA3', label: 'Uniswap Permit2', kind: 'permit2' },
      allowance: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      balance: '100000000000000000000',
    },
  ],
  score: 75,
  grade: 'CAUTION',
};

test('renderText leads with the verdict and includes the fix', () => {
  const text = renderText(BASE_REPORT);
  assert.match(text, /CAUTION — safety score 75\/100/);
  assert.match(text, /block\s+123456/);
  assert.match(text, /native\s+2 BNB/);
  assert.match(text, /Unlimited USDT allowance to Uniswap Permit2/);
  assert.match(text, /revoke\.cash\/address\/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/);
  assert.match(text, /cast send 0x55d398326f99059fF775485246999027B3197955 "approve\(address,uint256\)" 0x000000000022D473030F116dDEE9F6B43aC78BA3 0/);
});

test('renderText for a clean report says there are no findings', () => {
  const clean = { ...BASE_REPORT, findings: [], score: 100, grade: 'SAFE' };
  assert.match(renderText(clean), /No findings/);
  assert.match(renderText(clean), /SAFE — safety score 100\/100/);
});

test('renderText shows the delegate when present', () => {
  const delegated = {
    ...BASE_REPORT,
    delegated: '0x1111111111111111111111111111111111111111',
    findings: [{ severity: 'critical', code: 'EIP7702_DELEGATED', title: 'EOA is delegated to an unknown contract (EIP-7702)', detail: 'Code is 0xef0100.', delegate: '0x1111111111111111111111111111111111111111' }],
    score: 40,
    grade: 'RISKY',
  };
  const text = renderText(delegated);
  assert.match(text, /delegate 0x1111111111111111111111111111111111111111 \(EIP-7702\)/);
  assert.match(text, /clear the delegation/);
});

test('renderJson round-trips the report', () => {
  const parsed = JSON.parse(renderJson(BASE_REPORT));
  assert.equal(parsed.score, 75);
  assert.equal(parsed.findings[0].code, 'UNLIMITED_ALLOWANCE');
});

test('parseArgs handles flags and repeatable lists', () => {
  const args = parseArgs([
    '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    '--chain', 'ethereum',
    '--token', '0xabc0000000000000000000000000000000000001',
    '--token', '0xabc0000000000000000000000000000000000002',
    '--spender', '0xdef0000000000000000000000000000000000001',
    '--json',
  ]);
  assert.equal(args.address, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  assert.equal(args.chain, 'ethereum');
  assert.deepEqual(args.tokens, [
    '0xabc0000000000000000000000000000000000001',
    '0xabc0000000000000000000000000000000000002',
  ]);
  assert.deepEqual(args.spenders, ['0xdef0000000000000000000000000000000000001']);
  assert.equal(args.json, true);
});

test('parseArgs rejects unknown flags and two addresses', () => {
  assert.throws(() => parseArgs(['0xabc', '--bogus']), /unknown flag/);
  assert.throws(() => parseArgs(['0xabc', '0xdef']), /exactly one wallet address/);
});

test('usage documents the flags', () => {
  assert.match(usage(), /--chain bsc\|ethereum/);
  assert.match(usage(), /--token/);
  assert.match(usage(), /--json/);
});

test('main returns 2 with no address', async () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    assert.equal(await main([]), 2);
    assert.match(logs.join('\n'), /wallet-safety-sweep <address>/);
  } finally {
    console.log = origLog;
  }
});

test('main returns 2 for an invalid address without touching the network', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error('should not be called'); };
  assert.equal(await main(['not-an-address'], fetchImpl), 2);
  assert.equal(called, false);
});
