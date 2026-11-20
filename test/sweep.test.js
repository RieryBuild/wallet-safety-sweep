// Unit + integration tests for the sweep core. All offline: the chain is
// a stub fetch that answers from canned maps.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_UINT256,
  UNLIMITED_THRESHOLD,
  allowanceFindings,
  classifyAllowance,
  formatUnits,
  formatWei,
  grade,
  isAddress,
  isContract,
  parseDelegation,
  scoreFindings,
  sweep,
} from '../src/sweep.js';
import { ALLOWANCE_SELECTOR, BALANCE_SELECTOR } from '../src/sweep.js';

const WALLET = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const TOKEN_A = { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18 };
const TOKEN_B = { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18 };
const ROUTER = { address: '0x10ED43C718714eb63d5aA57B78B54704E256024E', label: 'PancakeSwap V2 Router', kind: 'router' };
const PERMIT2 = { address: '0x000000000022D473030F116dDEE9F6B43aC78BA3', label: 'Uniswap Permit2', kind: 'permit2' };

test('parseDelegation detects EIP-7702 code and returns the delegate', () => {
  assert.equal(parseDelegation('0xef0100' + '10ED43C718714eb63d5aA57B78B54704E256024E'), '0x10ed43c718714eb63d5aa57b78b54704e256024e');
  assert.equal(parseDelegation('0x'), null);
  assert.equal(parseDelegation('0x60006000'), null);
  assert.equal(parseDelegation('0xef0100' + 'abcd'), null); // too short to be a delegate
  assert.equal(parseDelegation(null), null);
});

test('isContract distinguishes empty code from deployed code', () => {
  assert.equal(isContract('0x'), false);
  assert.equal(isContract('0x60006000'), true);
  assert.equal(isContract('0xef0100' + '00'.repeat(20)), true);
});

test('isAddress validates checksum-agnostic addresses', () => {
  assert.equal(isAddress(WALLET), true);
  assert.equal(isAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA9604'), false);
  assert.equal(isAddress('d8dA6BF26964aF9D7eEd9e03E53415D37aA96045'), false);
  assert.equal(isAddress(''), false);
});

test('classifyAllowance: none / limited / covers-balance / unlimited', () => {
  assert.equal(classifyAllowance(0n, 100n), 'none');
  assert.equal(classifyAllowance(10n, 100n), 'limited');
  assert.equal(classifyAllowance(100n, 100n), 'covers-balance');
  assert.equal(classifyAllowance(150n, 100n), 'covers-balance');
  assert.equal(classifyAllowance(UNLIMITED_THRESHOLD, 100n), 'unlimited');
  assert.equal(classifyAllowance(MAX_UINT256, 0n), 'unlimited');
});

test('formatUnits prints human units without trailing zeros', () => {
  assert.equal(formatUnits(1500000n, 6), '1.5');
  assert.equal(formatUnits(1000000n, 6), '1');
  assert.equal(formatUnits(0n, 18), '0');
  assert.equal(formatUnits(1234567890123456789n, 18), '1.234567890123456789');
  assert.equal(formatWei(1000000000000000000n), '1');
});

test('scoreFindings deducts by severity and caps at 40 on critical', () => {
  assert.equal(scoreFindings([]), 100);
  assert.equal(scoreFindings([{ severity: 'low' }]), 98);
  assert.equal(scoreFindings([{ severity: 'medium' }]), 90);
  assert.equal(scoreFindings([{ severity: 'high' }]), 75);
  assert.equal(scoreFindings([{ severity: 'high' }, { severity: 'high' }]), 50);
  assert.equal(scoreFindings([{ severity: 'critical' }]), 40);
  assert.equal(scoreFindings([{ severity: 'critical' }, { severity: 'low' }]), 40); // critical caps the score at 40
  assert.equal(scoreFindings(Array(10).fill({ severity: 'high' })), 0);
});

test('grade bands', () => {
  assert.equal(grade(100), 'SAFE');
  assert.equal(grade(90), 'SAFE');
  assert.equal(grade(89), 'CAUTION');
  assert.equal(grade(70), 'CAUTION');
  assert.equal(grade(69), 'RISKY');
  assert.equal(grade(40), 'RISKY');
  assert.equal(grade(39), 'DANGER');
  assert.equal(grade(0), 'DANGER');
});

test('allowanceFindings flags unlimited, covers-balance, and limited', () => {
  const rows = [
    { token: TOKEN_A, spender: PERMIT2, allowance: MAX_UINT256, balance: 500n * 10n ** 18n },
    { token: TOKEN_B, spender: ROUTER, allowance: 100n * 10n ** 18n, balance: 100n * 10n ** 18n },
    { token: TOKEN_B, spender: PERMIT2, allowance: 5n * 10n ** 18n, balance: 100n * 10n ** 18n },
  ];
  const findings = allowanceFindings(rows);
  assert.equal(findings.length, 3);
  assert.equal(findings[0].severity, 'high');
  assert.equal(findings[0].code, 'UNLIMITED_ALLOWANCE');
  assert.equal(findings[1].code, 'ALLOWANCE_COVERS_BALANCE');
  assert.equal(findings[1].severity, 'medium');
  assert.equal(findings[2].code, 'LIMITED_ALLOWANCE');
  assert.equal(findings[2].severity, 'low');
});

test('allowanceFindings skips zero allowances', () => {
  const findings = allowanceFindings([
    { token: TOKEN_A, spender: ROUTER, allowance: 0n, balance: 0n },
  ]);
  assert.equal(findings.length, 0);
});

// --- stub chain ---------------------------------------------------------

// A fake fetch answering from canned maps. `code` is the wallet's code,
// `balances` maps token address -> BigInt, `allowances` maps
// `${token}:${spender}` -> BigInt. Unknown calls return 0x0.
function makeStubFetch({ code = '0x', balances = {}, allowances = {} } = {}) {
  const hex = (v) => '0x' + v.toString(16);
  return async (_url, { body }) => {
    const payload = JSON.parse(body);
    const requests = Array.isArray(payload) ? payload : [payload];
    const results = requests.map((req) => {
      let result = '0x0';
      if (req.method === 'eth_blockNumber') result = '0x123456';
      else if (req.method === 'eth_getCode') result = code;
      else if (req.method === 'eth_getBalance') result = hex(2n * 10n ** 18n);
      else if (req.method === 'eth_call') {
        const { to, data } = req.params[0];
        const selector = data.slice(0, 10);
        if (selector === BALANCE_SELECTOR) {
          const v = balances[to.toLowerCase()];
          result = v === undefined ? hex(0n) : hex(v);
        } else if (selector === ALLOWANCE_SELECTOR) {
          const spender = '0x' + data.slice(-40);
          const v = allowances[`${to.toLowerCase()}:${spender.toLowerCase()}`];
          result = v === undefined ? hex(0n) : hex(v);
        }
      }
      return { jsonrpc: '2.0', id: req.id, result };
    });
    return { ok: true, json: async () => (Array.isArray(payload) ? results : results[0]) };
  };
}

test('sweep: clean EOA scores 100 with no findings', async () => {
  const report = await sweep({
    address: WALLET,
    chain: 'bsc',
    tokens: [TOKEN_A],
    spenders: [ROUTER],
    fetchImpl: makeStubFetch(),
  });
  assert.equal(report.score, 100);
  assert.equal(report.grade, 'SAFE');
  assert.equal(report.findings.length, 0);
  assert.equal(report.blockNumber, (0x123456).toString());
  assert.equal(report.nativeBalanceFormatted, '2');
  assert.equal(report.delegated, null);
  assert.equal(report.isContract, false);
});

test('sweep: unlimited Permit2 allowance is a high finding', async () => {
  const report = await sweep({
    address: WALLET,
    chain: 'bsc',
    tokens: [TOKEN_A],
    spenders: [PERMIT2],
    fetchImpl: makeStubFetch({
      balances: { [TOKEN_A.address.toLowerCase()]: 100n * 10n ** 18n },
      allowances: { [`${TOKEN_A.address.toLowerCase()}:${PERMIT2.address.toLowerCase()}`]: MAX_UINT256 },
    }),
  });
  assert.equal(report.score, 75);
  assert.equal(report.grade, 'CAUTION');
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].code, 'UNLIMITED_ALLOWANCE');
  assert.equal(report.allowances[0].classification, 'unlimited');
});

test('sweep: delegated EOA to an unknown contract is critical and caps at 40', async () => {
  const evil = '0x1111111111111111111111111111111111111111';
  const report = await sweep({
    address: WALLET,
    chain: 'bsc',
    tokens: [TOKEN_A],
    spenders: [ROUTER],
    fetchImpl: makeStubFetch({ code: '0xef0100' + evil.slice(2) }),
  });
  assert.equal(report.delegated, evil);
  assert.equal(report.score, 40);
  assert.equal(report.grade, 'RISKY');
  assert.equal(report.findings[0].code, 'EIP7702_DELEGATED');
  assert.equal(report.findings[0].severity, 'critical');
});

test('sweep: delegation finding names the delegate address', async () => {
  const delegate = '0x2222222222222222222222222222222222222222';
  const report = await sweep({
    address: WALLET,
    chain: 'ethereum',
    tokens: [TOKEN_A],
    spenders: [ROUTER],
    fetchImpl: makeStubFetch({ code: '0xef0100' + delegate.slice(2) }),
  });
  assert.equal(report.findings[0].severity, 'critical');
  assert.equal(report.findings[0].delegate, delegate);
  assert.match(report.findings[0].detail, new RegExp(delegate));
});

test('sweep: rejects an invalid address and an unknown chain', async () => {
  await assert.rejects(
    () => sweep({ address: 'not-an-address', chain: 'bsc', fetchImpl: makeStubFetch() }),
    /invalid address/,
  );
  await assert.rejects(
    () => sweep({ address: WALLET, chain: 'solana', fetchImpl: makeStubFetch() }),
    /unknown chain/,
  );
});
