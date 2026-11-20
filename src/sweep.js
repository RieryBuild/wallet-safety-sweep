// Core sweep logic: pure functions first (delegation, allowance
// classification, scoring), then the orchestration that reads a chain.
//
// Design rules, learned the hard way from hunting free mints:
// - A revert cannot tell "no allowance" from "function missing", so every
//   token is only read after confirming the address is a contract at all
//   is not required — allowance() on an EOA returns 0, which is fine —
//   but a token whose balanceOf/allowance call reverts is reported as
//   UNREADABLE, never silently treated as zero.
// - "Unlimited" means >= 2^255. Some UIs call 2^256-1 unlimited and some
//   tokens use 2^255; anything at or above 2^255 lets a spender drain the
//   whole balance and every future deposit, so it is flagged the same.
// - Every read is pinned to one block number. The report prints it, so a
//   finding is a snapshot at a known block, not a moving target.

import { CHAINS, SPENDERS, TOKENS } from './lists.js';
import { encodeCall, getBalance, getBlockNumber, getCode, padAddress, rpcBatch } from './rpc.js';

export const ALLOWANCE_SELECTOR = '0xdd62ed3e'; // allowance(address,address)
export const BALANCE_SELECTOR = '0x70a08231'; // balanceOf(address)
export const UNLIMITED_THRESHOLD = 2n ** 255n;
export const MAX_UINT256 = 2n ** 256n - 1n;

export function isAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function normalizeAddress(value) {
  return value.toLowerCase();
}

// EIP-7702 delegation: code is exactly 0xef0100 + 20-byte delegate address.
export function parseDelegation(code) {
  if (typeof code !== 'string') return null;
  const lower = code.toLowerCase();
  if (!lower.startsWith('0xef0100')) return null;
  if (lower.length !== 2 + 6 + 40) return null;
  return '0x' + lower.slice(8);
}

export function isContract(code) {
  return typeof code === 'string' && code !== '0x' && code.length > 2;
}

export function classifyAllowance(allowance, balance) {
  if (allowance === 0n) return 'none';
  if (allowance >= UNLIMITED_THRESHOLD) return 'unlimited';
  if (balance > 0n && allowance >= balance) return 'covers-balance';
  return 'limited';
}

export function formatUnits(raw, decimals) {
  const rawBig = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = rawBig / base;
  const frac = rawBig % base;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

export function formatWei(raw) {
  return formatUnits(raw, 18);
}

// Severity weights for the 0-100 safety score. A single critical finding
// (delegated EOA to an unknown contract) caps the score at 40 no matter
// what else is clean — delegation hands the keys to another contract.
export function scoreFindings(findings) {
  let score = 100;
  let hasCritical = false;
  for (const f of findings) {
    if (f.severity === 'critical') { score -= 40; hasCritical = true; }
    else if (f.severity === 'high') score -= 25;
    else if (f.severity === 'medium') score -= 10;
    else if (f.severity === 'low') score -= 2;
  }
  if (hasCritical) score = Math.min(score, 40);
  return Math.max(0, score);
}

export function grade(score) {
  if (score >= 90) return 'SAFE';
  if (score >= 70) return 'CAUTION';
  if (score >= 40) return 'RISKY';
  return 'DANGER';
}

// Turn raw allowance rows into findings. `rows` are
// { token, spender, allowance, balance } with BigInts.
export function allowanceFindings(rows) {
  const findings = [];
  for (const row of rows) {
    const kind = classifyAllowance(row.allowance, row.balance);
    if (kind === 'none') continue;
    if (kind === 'unlimited') {
      findings.push({
        severity: 'high',
        code: 'UNLIMITED_ALLOWANCE',
        title: `Unlimited ${row.token.symbol} allowance to ${row.spender.label}`,
        detail:
          row.spender.kind === 'permit2'
            ? `Permit2 can pull any amount with a valid signature. Allowance is ${row.allowance === MAX_UINT256 ? 'type(uint256).max' : '>= 2^255'}; revoke or cap it unless you actively trade through Permit2.`
            : `Any future ${row.token.symbol} deposit can be moved by ${row.spender.label} without another approval.`,
        token: row.token,
        spender: row.spender,
        allowance: row.allowance.toString(),
        balance: row.balance.toString(),
      });
    } else if (kind === 'covers-balance') {
      findings.push({
        severity: 'medium',
        code: 'ALLOWANCE_COVERS_BALANCE',
        title: `${row.spender.label} can move your whole ${row.token.symbol} balance`,
        detail: `Allowance (${formatUnits(row.allowance, row.token.decimals)} ${row.token.symbol}) covers your full balance. Limited, but a drain of everything you hold is one call away.`,
        token: row.token,
        spender: row.spender,
        allowance: row.allowance.toString(),
        balance: row.balance.toString(),
      });
    } else {
      findings.push({
        severity: 'low',
        code: 'LIMITED_ALLOWANCE',
        title: `Limited ${row.token.symbol} allowance to ${row.spender.label}`,
        detail: `Allowance is ${formatUnits(row.allowance, row.token.decimals)} ${row.token.symbol} against a balance of ${formatUnits(row.balance, row.token.decimals)}. Capped exposure, but worth reviewing.`,
        token: row.token,
        spender: row.spender,
        allowance: row.allowance.toString(),
        balance: row.balance.toString(),
      });
    }
  }
  return findings;
}

export async function sweep({ address, chain = 'bsc', rpcUrl, tokens, spenders, fetchImpl = fetch }) {
  if (!isAddress(address)) throw new Error(`invalid address: ${address}`);
  const preset = CHAINS[chain];
  if (!preset) throw new Error(`unknown chain: ${chain} (use bsc or ethereum, or --rpc with a known chain)`);
  const rpc = rpcUrl || preset.rpc;
  const tokenList = tokens || TOKENS[chain];
  const spenderList = spenders || SPENDERS[chain];

  const blockHex = await getBlockNumber(rpc, fetchImpl);
  const blockNumber = BigInt(blockHex);
  const [code, nativeBalanceHex] = await Promise.all([
    getCode(rpc, address, blockHex, fetchImpl),
    getBalance(rpc, address, blockHex, fetchImpl),
  ]);

  const findings = [];
  const delegate = parseDelegation(code);
  if (delegate) {
    findings.push({
      severity: 'critical',
      code: 'EIP7702_DELEGATED',
      title: 'EOA is delegated to a contract (EIP-7702)',
      detail: `Code is 0xef0100 + ${delegate}. This EOA's execution is delegated to a contract — its code runs as your wallet, so a bug or a malicious upgrade in it can drain the account. Treat the wallet as compromised until the delegation is cleared (set it back to an empty delegation or one you control).`,
      delegate,
    });
  } else if (isContract(code)) {
    findings.push({
      severity: 'info',
      code: 'CONTRACT_WALLET',
      title: 'Address is a smart contract wallet',
      detail: 'Not an EOA. Allowances below still apply; contract wallets have their own upgrade/owner risks that this sweep does not assess.',
    });
  }

  // Balances first (one batch), then allowances (one batch). A token whose
  // balanceOf reverts is kept with balance null and reported unreadable.
  const balanceCalls = tokenList.map((t) => ({
    method: 'eth_call',
    params: [{ to: t.address, data: encodeCall(BALANCE_SELECTOR, padAddress(address)) }, blockHex],
  }));
  const balanceResults = await rpcBatch(rpc, balanceCalls, fetchImpl);
  const balances = new Map();
  const unreadable = [];
  tokenList.forEach((token, i) => {
    const res = balanceResults[i];
    if (res instanceof Error || res === null || res === '0x') {
      unreadable.push(token);
      balances.set(token.address, null);
    } else {
      try { balances.set(token.address, BigInt(res)); }
      catch { unreadable.push(token); balances.set(token.address, null); }
    }
  });

  const allowanceCalls = [];
  const allowanceIndex = [];
  for (const token of tokenList) {
    if (balances.get(token.address) === null) continue;
    for (const spender of spenderList) {
      allowanceCalls.push({
        method: 'eth_call',
        params: [{
          to: token.address,
          data: encodeCall(ALLOWANCE_SELECTOR, padAddress(address), padAddress(spender.address)),
        }, blockHex],
      });
      allowanceIndex.push({ token, spender });
    }
  }
  const allowanceResults = await rpcBatch(rpc, allowanceCalls, fetchImpl);
  const rows = [];
  allowanceIndex.forEach(({ token, spender }, i) => {
    const res = allowanceResults[i];
    if (res instanceof Error || res === null || res === '0x') return;
    let allowance;
    try { allowance = BigInt(res); } catch { return; }
    if (allowance === 0n) return;
    rows.push({ token, spender, allowance, balance: balances.get(token.address) ?? 0n });
  });

  findings.push(...allowanceFindings(rows));

  for (const token of unreadable) {
    findings.push({
      severity: 'low',
      code: 'TOKEN_UNREADABLE',
      title: `Could not read ${token.symbol} (${token.address})`,
      detail: 'balanceOf reverted or returned nothing. The token may not exist on this chain or may not be a standard ERC-20; its allowance was not checked.',
      token,
    });
  }

  const score = scoreFindings(findings);
  return {
    address,
    chain,
    chainId: preset.chainId,
    chainName: preset.name,
    rpc,
    blockNumber: blockNumber.toString(),
    nativeBalance: nativeBalanceHex,
    nativeBalanceFormatted: formatWei(BigInt(nativeBalanceHex)),
    nativeSymbol: preset.nativeSymbol,
    explorer: preset.explorer,
    delegated: delegate,
    isContract: !delegate && isContract(code),
    balances: tokenList.map((t) => ({
      token: t,
      balance: balances.get(t.address) === null ? null : balances.get(t.address).toString(),
      balanceFormatted: balances.get(t.address) === null ? null : formatUnits(balances.get(t.address), t.decimals),
    })),
    allowances: rows.map((r) => {
      const classification = classifyAllowance(r.allowance, r.balance);
      return {
        token: r.token.symbol,
        tokenAddress: r.token.address,
        spender: r.spender.label,
        spenderAddress: r.spender.address,
        spenderKind: r.spender.kind,
        allowance: r.allowance.toString(),
        // An unlimited allowance formatted in token units is a 70-digit
        // number nobody can read; say so instead. The raw value stays in
        // `allowance` above.
        allowanceFormatted: classification === 'unlimited' ? 'unlimited' : formatUnits(r.allowance, r.token.decimals),
        classification,
      };
    }),
    findings,
    score,
    grade: grade(score),
  };
}
