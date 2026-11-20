# wallet-safety-sweep

Before you send funds to a wallet — or keep using one — check what it has
already given away. This CLI sweeps an EVM wallet, read-only, and reports
what can move its tokens and whether the wallet itself is still an EOA:

```text
$ wallet-safety-sweep 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --chain ethereum

⛔ DANGER — safety score 0/100
  wallet   0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  chain    Ethereum (chain id 1)
  block    26453357 (all reads pinned to this block)
  native   5.798969845714210716 ETH
  delegate 0x5a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d (EIP-7702)

Balances (checked tokens):
  USDT   301.36822
  USDC   39.192124
  WETH   1.468927766030343079
  DAI    14.372082162212001768
  UNI    0.0001168
  AAVE   0.01015207
  SHIB   548.53722685

Findings (7):

⛔ [CRITICAL] EOA is delegated to a contract (EIP-7702)
  Code is 0xef0100 + 0x5a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d. This EOA's
  execution is delegated to a contract — its code runs as your wallet, so a
  bug or a malicious upgrade in it can drain the account. Treat the wallet
  as compromised until the delegation is cleared (set it back to an empty
  delegation or one you control).
  fix: clear the delegation from a trusted wallet UI, or set it to a
  delegation you control. Do not send funds here until it is cleared.

🔴 [HIGH] Unlimited USDT allowance to Uniswap V3 SwapRouter
  Any future USDT deposit can be moved by Uniswap V3 SwapRouter without
  another approval.
  fix: revoke or cap it —
    revoke.cash: https://revoke.cash/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
    or cast: cast send 0xdAC17F958D2ee523a2206206994597C13D831ec7 "approve(address,uint256)" 0xE592427A0AEce92De3Edee1F18E0157C05861564 0 --from 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045

…plus unlimited DAI to Permit2, unlimited WBTC / LINK / SHIB to the V3
SwapRouter, and unlimited PEPE to the V2 Router. Full JSON:
[`examples/vitalik-ethereum.json`](examples/vitalik-ethereum.json).

Score 0/100 — DANGER. Re-run after revoking to confirm the score moves.
```

That address is vitalik.eth — the delegation and the unlimited allowances
are real, read live from Ethereum at block 26453357. The BSC sweep of the
same wallet ([`examples/vitalik-bsc.json`](examples/vitalik-bsc.json),
block 134616382) finds the same delegation and no allowances: score 40,
RISKY.

## Why this exists

Three ways wallets quietly lose money, all invisible in a normal balance
check:

1. **Unlimited allowances.** Approving a router once usually approves
   `type(uint256).max` — forever, for any future deposit. If that spender
   is ever exploited, or you approved a lookalike, the whole balance and
   every later deposit can be drained with no further signature from you.
2. **EIP-7702 delegation.** Since Pectra, an EOA can carry code
   (`0xef0100` + a delegate address). A delegated wallet is no longer
   "just a key" — the delegate contract's code runs as the wallet. A
   phishing signature that sets a delegation is a full takeover, and it
   does not show up in any token balance.
3. **Permit2.** One approval to Permit2 lets any contract with a valid
   signature pull the token. It is the most-approved contract in the
   ecosystem and the least understood.

The sweep checks all three, plus token balances for context, and prints a
fix for every finding — a revoke.cash link and the exact `cast` command —
instead of just a warning.

## Install

Requires Node.js 18+ (uses the built-in `fetch` and `node:test`). Zero
runtime dependencies.

```bash
git clone https://github.com/RieryBuild/wallet-safety-sweep.git
cd wallet-safety-sweep
npm test          # 33 tests, no network needed
```

## Usage

```bash
wallet-safety-sweep <address> [--chain bsc|ethereum] [--rpc URL]
                        [--token 0x...] [--spender 0x...] [--json] [--out FILE]
```

- `--chain` — `bsc` (default) or `ethereum`. Each chain has its own
  default RPC, token list, and spender list.
- `--rpc` — custom JSON-RPC endpoint, e.g. your own node. Overrides the
  chain default.
- `--token` — an extra ERC-20 to check (repeatable; 18 decimals assumed).
- `--spender` — an extra spender to check allowances against (repeatable).
- `--json` — machine-readable output instead of the text report.
- `--out` — write the output to a file instead of stdout.

```bash
# Your own wallet on BSC
wallet-safety-sweep 0xYourAddressHere

# Ethereum, JSON output for scripting
wallet-safety-sweep 0xYourAddressHere --chain ethereum --json

# Also check a token and a spender that aren't in the built-in lists
wallet-safety-sweep 0xYourAddressHere --token 0xSomeToken --spender 0xSomeSpender
```

No transaction, no key, no wallet connection. Everything is `eth_call`,
`eth_getCode`, and `eth_getBalance` — the tool cannot move funds.

## What it checks

| Check | How | Severity |
| --- | --- | --- |
| EIP-7702 delegation | `eth_getCode` starts with `0xef0100` | Critical |
| Unlimited allowance (≥ 2^255) to a known spender | `allowance(owner, spender)` | High |
| Allowance covering the full balance | same read | Medium |
| Limited allowance > 0 | same read | Low |
| Token that cannot be read | `balanceOf` reverts / empty | Low |
| Address is a contract wallet | `eth_getCode` non-empty, not a delegation | Info |

**Default tokens (10 per chain):** the stablecoins and wrapped assets
most wallets hold — USDT, USDC, WBNB/WETH, BUSD, DAI, CAKE, ETH, BTCB,
FDUSD, TUSD on BSC; USDT, USDC, WETH, DAI, WBTC, LINK, UNI, AAVE, PEPE,
SHIB on Ethereum.

**Default spenders:** Uniswap Permit2, PancakeSwap V2 Router + V3
SwapRouter, Uniswap V2 Router + V3 SwapRouter + Universal Router, 1inch
Aggregation Router v6, OpenSea Seaport 1.6. Spenders that do not exist on
a chain are not listed for it (e.g. no V3 SwapRouter on BSC).

**Score:** starts at 100; −40 critical, −25 high, −10 medium, −2 low. A
critical finding caps the score at 40. Grades: ≥90 SAFE, ≥70 CAUTION,
≥40 RISKY, below that DANGER.

## Design rules

- **Pinned block.** Every read in a run uses one block number, printed in
  the report. A finding is a snapshot at a known block, not a moving
  target — and a passing clean sweep is a timestamp, not a guarantee.
- **Batched reads, retried.** A sweep is ~10 tokens × ~8 spenders of
  `eth_call`s. They go out as batched JSON-RPC (25 per request) with
  backoff on HTTP 429/5xx, so the CLI stays usable on public RPCs.
- **A revert is reported, never silently zero.** A token whose `balanceOf`
  reverts is listed as unreadable and its allowances are not checked —
  the tool never claims "no allowance" for a token it could not read.
- **"Unlimited" means ≥ 2^255**, not just `type(uint256).max`. Some UIs
  approve 2^255; either value lets a spender drain the balance and every
  future deposit.
- **Every address in the built-in lists was verified on-chain.**
  `eth_getCode` was checked for each token and spender on its chain
  (2026-11-20). Two entries that looked right from memory did not survive
  that check and were dropped: the supposed Blur exchange address is an
  empty EOA on Etherscan, and the old SushiSwap V2 router has no code on
  Ethereum mainnet. `test/lists.test.js` guards the address format; the
  on-chain check is worth re-running after any list edit.

## Examples

- [`examples/vitalik-ethereum.json`](examples/vitalik-ethereum.json) —
  vitalik.eth on Ethereum, block 26453357: DANGER 0/100 (delegation + 6
  unlimited allowances).
- [`examples/vitalik-bsc.json`](examples/vitalik-bsc.json) — the same
  wallet on BSC, block 134616382: RISKY 40/100 (delegation only).

## License

MIT — see [LICENSE](LICENSE).
