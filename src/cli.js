#!/usr/bin/env node
// wallet-safety-sweep — sweep an EVM wallet for safety risks, read-only.
//
//   wallet-safety-sweep <address> [--chain bsc|ethereum] [--rpc URL]
//                         [--token 0x...] [--spender 0x...] [--json] [--out FILE]
//
// Checks: EIP-7702 delegation, token balances, and allowances to known
// spenders (Permit2, DEX routers, NFT marketplaces). Prints a score and a
// fix for every finding. Makes no transactions and asks for no keys.

import { readFileSync, writeFileSync } from 'node:fs';
import { CHAINS, SPENDERS, TOKENS } from './lists.js';
import { renderJson, renderText } from './report.js';
import { isAddress, sweep } from './sweep.js';

export function parseArgs(argv) {
  const args = { tokens: [], spenders: [], chain: 'bsc', json: false, out: null, rpc: null, address: null };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--chain') args.chain = argv[++i];
    else if (a === '--rpc') args.rpc = argv[++i];
    else if (a === '--token') args.tokens.push(argv[++i]);
    else if (a === '--spender') args.spenders.push(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    else rest.push(a);
  }
  if (rest.length > 1) throw new Error('expected exactly one wallet address');
  [args.address] = rest;
  return args;
}

export function usage() {
  return [
    'wallet-safety-sweep <address> [--chain bsc|ethereum] [--rpc URL]',
    '                         [--token 0x...] [--spender 0x...] [--json] [--out FILE]',
    '',
    'Read-only sweep of an EVM wallet: EIP-7702 delegation, token balances,',
    'and allowances to known spenders (Permit2, DEX routers, marketplaces).',
    'No transaction, no key, no wallet connection.',
    '',
    '  --chain    bsc (default) or ethereum',
    '  --rpc      custom JSON-RPC endpoint (overrides the chain default)',
    '  --token    extra ERC-20 to check (repeatable; 18 decimals assumed)',
    '  --spender  extra spender to check allowances against (repeatable)',
    '  --json     machine-readable output instead of the text report',
    '  --out      write the output to a file instead of stdout',
    '',
    'Examples:',
    '  wallet-safety-sweep 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    '  wallet-safety-sweep 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --chain ethereum --json',
  ].join('\n');
}

export async function main(argv, fetchImpl = fetch) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`error: ${err.message}\n\n${usage()}`);
    return 2;
  }
  if (args.help || !args.address) {
    console.log(usage());
    return args.help ? 0 : 2;
  }
  if (!isAddress(args.address)) {
    console.error(`error: invalid address: ${args.address}`);
    return 2;
  }
  const preset = CHAINS[args.chain];
  if (!preset && !args.rpc) {
    console.error(`error: unknown chain: ${args.chain} (use bsc or ethereum)`);
    return 2;
  }

  const extraTokens = args.tokens.map((address) => {
    if (!isAddress(address)) throw new Error(`invalid --token address: ${address}`);
    return { address, symbol: address.slice(0, 6) + '…' + address.slice(-4), decimals: 18 };
  });
  const extraSpenders = args.spenders.map((address) => {
    if (!isAddress(address)) throw new Error(`invalid --spender address: ${address}`);
    return { address, label: `custom spender ${address}`, kind: 'custom' };
  });

  let report;
  try {
    report = await sweep({
      address: args.address,
      chain: args.chain,
      rpcUrl: args.rpc,
      tokens: extraTokens.length > 0 ? [...(TOKENS[args.chain] || []), ...extraTokens] : undefined,
      spenders: extraSpenders.length > 0 ? [...(SPENDERS[args.chain] || []), ...extraSpenders] : undefined,
      fetchImpl,
    });
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 1;
  }

  const output = args.json ? renderJson(report) : renderText(report);
  if (args.out) writeFileSync(args.out, output + '\n');
  else console.log(output);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
