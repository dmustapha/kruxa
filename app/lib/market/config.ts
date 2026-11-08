// Market UI configuration. Reads NEXT_PUBLIC_* literally so Next can inline them. Never reads secrets.
const e = (v: string | undefined, d: string): string => (v && v.length > 0 ? v : d);

export const MARKET_CONFIG = {
  /** Base URL of the indexer read API (docs/interfaces/api.openapi.yaml). */
  apiBase: e(process.env.NEXT_PUBLIC_KRUXA_API, 'http://localhost:8787').replace(/\/+$/, ''),
  /** The market contract (MARKET-ABI.md). */
  marketAccount: e(process.env.NEXT_PUBLIC_MARKET_ACCOUNT, 'market.kruxa.testnet'),
  usdcAccount: e(process.env.NEXT_PUBLIC_USDC_ACCOUNT, 'usdc.kruxa.testnet'),
  rpcUrl: e(process.env.NEXT_PUBLIC_NEAR_RPC, 'https://rpc.testnet.near.org'),
  explorerTx: e(process.env.NEXT_PUBLIC_EXPLORER_TX, 'https://testnet.nearblocks.io/txns/'),
} as const;

/** 100 Tgas for ft_transfer_call (ft_on_transfer plus resolve) and for claim. */
export const GAS_TRADE = '100000000000000';
export const GAS_CLAIM = '100000000000000';
export const ONE_YOCTO = '1';
export const MIN_TRADE_QUOTE = 1_000_000n; // MARKET-ABI: USDC $1
export const TOKEN_DECIMALS = 6;
export const QUOTE_DECIMALS = 6;
