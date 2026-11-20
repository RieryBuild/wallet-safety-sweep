// Curated token + spender registries and chain presets.
//
// These are the addresses the sweep checks by default. They are the tokens
// most wallets actually hold and the spenders most wallets actually approve:
// DEX routers, Permit2, and the big NFT marketplaces. A user can extend
// either list with --token / --spender; nothing here is fetched from a
// remote list, so the sweep works the same way every run.
//
// Every address here was verified to hold contract code on its chain via
// eth_getCode on 2026-11-20 (BSC via bsc-dataseed, Ethereum via
// ethereum-rpc.publicnode.com). Two entries that looked right from memory
// did not survive that check and were dropped: Blur's supposed exchange
// address is an empty EOA on Etherscan, and the SushiSwap V2 router has no
// code on Ethereum mainnet. The Seaport entry is Seaport 1.6, the current
// cross-chain deployment (seaport-js constants). test/lists.test.js guards
// the format; the on-chain check is worth re-running after any edit.

export const CHAINS = {
  bsc: {
    name: 'BNB Smart Chain',
    chainId: 56,
    rpc: 'https://bsc-rpc.publicnode.com',
    nativeSymbol: 'BNB',
    explorer: 'https://bscscan.com',
  },
  ethereum: {
    name: 'Ethereum',
    chainId: 1,
    rpc: 'https://ethereum-rpc.publicnode.com',
    nativeSymbol: 'ETH',
    explorer: 'https://etherscan.io',
  },
};

// Spenders are grouped so the report can explain the practical risk:
// routers move your tokens when you trade, Permit2 lets any contract with
// a valid signature pull them, marketplaces move them when you list.
export const SPENDERS = {
  bsc: [
    { address: '0x000000000022D473030F116dDEE9F6B43aC78BA3', label: 'Uniswap Permit2', kind: 'permit2' },
    { address: '0x10ED43C718714eb63d5aA57B78B54704E256024E', label: 'PancakeSwap V2 Router', kind: 'router' },
    { address: '0x1b81D678ffb9C0263b24A97847620C99d213eB14', label: 'PancakeSwap V3 SwapRouter', kind: 'router' },
    { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', label: 'Uniswap V2 Router', kind: 'router' },
    { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', label: 'Uniswap Universal Router', kind: 'router' },
    { address: '0x111111125421cA6dc452d289314280a0f8842A65', label: '1inch Aggregation Router v6', kind: 'router' },
    { address: '0x0000000000000068F116a894984e2DB1123eB395', label: 'OpenSea Seaport 1.6', kind: 'marketplace' },
  ],
  ethereum: [
    { address: '0x000000000022D473030F116dDEE9F6B43aC78BA3', label: 'Uniswap Permit2', kind: 'permit2' },
    { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', label: 'Uniswap V2 Router', kind: 'router' },
    { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', label: 'Uniswap V3 SwapRouter', kind: 'router' },
    { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', label: 'Uniswap Universal Router', kind: 'router' },
    { address: '0x111111125421cA6dc452d289314280a0f8842A65', label: '1inch Aggregation Router v6', kind: 'router' },
    { address: '0x0000000000000068F116a894984e2DB1123eB395', label: 'OpenSea Seaport 1.6', kind: 'marketplace' },
  ],
};

// Tokens checked by default: the stablecoins and wrapped assets that make
// up almost every wallet's balance. Decimals are needed to print balances
// in human units; allowance math itself always uses raw units.
export const TOKENS = {
  bsc: [
    { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18 },
    { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18 },
    { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', decimals: 18 },
    { address: '0xe9e7CEA3DedcA5984780Bafc599bD69aDD087D56', symbol: 'BUSD', decimals: 18 },
    { address: '0x1AF3F329e8BE154074D8769D1fFa4eE058B1DBc3', symbol: 'DAI', decimals: 18 },
    { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE', decimals: 18 },
    { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH', decimals: 18 },
    { address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'BTCB', decimals: 18 },
    { address: '0xc5f0f7b66764F6ec8c8Dff7Ba683102295E16409', symbol: 'FDUSD', decimals: 18 },
    { address: '0x14016E85a25aeb13065688CaFb43044C2eF86784', symbol: 'TUSD', decimals: 18 },
  ],
  ethereum: [
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 },
    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8 },
    { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', decimals: 18 },
    { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI', decimals: 18 },
    { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', symbol: 'AAVE', decimals: 18 },
    { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', symbol: 'PEPE', decimals: 18 },
    { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', symbol: 'SHIB', decimals: 18 },
  ],
};
