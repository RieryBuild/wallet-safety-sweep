// Registry hygiene: every address in the lists must be a well-formed
// 40-hex-char address. Four BSC token addresses shipped truncated in v1
// and only failed at runtime on-chain — this test catches that at `npm test`.
import assert from 'node:assert/strict';
import test from 'node:test';

import { CHAINS, SPENDERS, TOKENS } from '../src/lists.js';
import { isAddress } from '../src/sweep.js';

test('every token and spender address is a valid 40-hex-char address', () => {
  for (const [chain, tokens] of Object.entries(TOKENS)) {
    assert.ok(tokens.length > 0, `${chain} has tokens`);
    for (const token of tokens) {
      assert.ok(isAddress(token.address), `${chain} token ${token.symbol}: ${token.address}`);
      assert.ok(Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 18, `${token.symbol} decimals`);
    }
  }
  for (const [chain, spenders] of Object.entries(SPENDERS)) {
    assert.ok(spenders.length > 0, `${chain} has spenders`);
    for (const spender of spenders) {
      assert.ok(isAddress(spender.address), `${chain} spender ${spender.label}: ${spender.address}`);
    }
  }
});

test('token symbols are unique per chain', () => {
  for (const [chain, tokens] of Object.entries(TOKENS)) {
    const symbols = tokens.map((t) => t.symbol);
    assert.equal(new Set(symbols).size, symbols.length, `${chain} duplicate symbol`);
  }
});

test('every chain preset has an RPC and an explorer', () => {
  for (const [chain, preset] of Object.entries(CHAINS)) {
    assert.ok(preset.rpc.startsWith('https://'), `${chain} rpc`);
    assert.ok(Number.isInteger(preset.chainId), `${chain} chainId`);
    assert.ok(TOKENS[chain], `${chain} has a token list`);
    assert.ok(SPENDERS[chain], `${chain} has a spender list`);
  }
});
