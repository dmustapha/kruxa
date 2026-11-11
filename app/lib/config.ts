// Single place that reads configuration. Next inlines only literal `process.env.NEXT_PUBLIC_X` reads, so every key is spelled out.
// Mainnet is refused without Dami's per-action confirmation token.
const pick = (v: string | undefined, d: string): string => (v !== undefined && v !== '' ? v : d);

export const NETWORK = pick(process.env.NEXT_PUBLIC_NEAR_NETWORK, 'testnet');

const MAINNET_CONFIRMATION_TOKEN = 'DAMI-PER-ACTION-CONFIRMED';

/** Pure gate (tested in config.test.ts): mainnet starts only with the exact confirmation token. Any other network passes. */
export function assertMainnetGate(network: string, confirmed: string | undefined): void {
  if (network === 'mainnet' && confirmed !== MAINNET_CONFIRMATION_TOKEN) {
    throw new Error('R_MAINNET_GATE: mainnet needs Dami per-action confirmation; refusing to start');
  }
}

assertMainnetGate(NETWORK, process.env.NEXT_PUBLIC_MAINNET_CONFIRMED);

/** Placeholder accounts used when nothing is configured. They are NOT deployed. `npm run dev:testnet` loads .env.testnet, which names the live testnet stack. */
export const PLACEHOLDER_CORE = 'core.kruxa.testnet';

/** Pure gate (tested in config.test.ts): mainnet must name every contract account explicitly; a testnet placeholder is never a mainnet default. */
export function assertExplicitMainnetAccounts(network: string, env: Record<string, string | undefined>): void {
  if (network !== 'mainnet') return;
  const missing = ['NEXT_PUBLIC_CORE_ACCOUNT', 'NEXT_PUBLIC_USDC_ACCOUNT', 'NEXT_PUBLIC_USDC_TOKEN_ID', 'NEXT_PUBLIC_INTENTS_ACCOUNT', 'NEXT_PUBLIC_MARKET_ACCOUNT', 'NEXT_PUBLIC_INSTANT_ACCOUNT']
    .filter((k) => !env[k]);
  if (missing.length) throw new Error(`R_MAINNET_ACCOUNTS: mainnet has no default accounts; set ${missing.join(', ')}`);
}

assertExplicitMainnetAccounts(NETWORK, {
  NEXT_PUBLIC_CORE_ACCOUNT: process.env.NEXT_PUBLIC_CORE_ACCOUNT,
  NEXT_PUBLIC_USDC_ACCOUNT: process.env.NEXT_PUBLIC_USDC_ACCOUNT,
  NEXT_PUBLIC_USDC_TOKEN_ID: process.env.NEXT_PUBLIC_USDC_TOKEN_ID,
  NEXT_PUBLIC_INTENTS_ACCOUNT: process.env.NEXT_PUBLIC_INTENTS_ACCOUNT,
  NEXT_PUBLIC_MARKET_ACCOUNT: process.env.NEXT_PUBLIC_MARKET_ACCOUNT,
  NEXT_PUBLIC_INSTANT_ACCOUNT: process.env.NEXT_PUBLIC_INSTANT_ACCOUNT,
});

export const CONFIG = {
  network: NETWORK,
  rpcUrl: pick(process.env.NEXT_PUBLIC_NEAR_RPC, 'https://rpc.testnet.near.org'),
  core: pick(process.env.NEXT_PUBLIC_CORE_ACCOUNT, PLACEHOLDER_CORE),
  usdc: pick(process.env.NEXT_PUBLIC_USDC_ACCOUNT, 'usdc.kruxa.testnet'),
  intents: pick(process.env.NEXT_PUBLIC_INTENTS_ACCOUNT, 'intents.kruxa.testnet'),
  factory: pick(process.env.NEXT_PUBLIC_FACTORY_ACCOUNT, 'factory.kruxa.testnet'),
  /** Market-lite contract (docs/interfaces/MARKET-ABI.md). The testnet account name is a placeholder until it is deployed. */
  market: pick(process.env.NEXT_PUBLIC_MARKET_ACCOUNT, 'market.kruxa.testnet'),
  /** The Intents token id of USDC that the core contract accepts (`usdc_token_id`). Config, not a guess: set it to the deployed value. */
  usdcTokenId: pick(process.env.NEXT_PUBLIC_USDC_TOKEN_ID, 'nep141:usdc.kruxa.testnet'),
  /** Indexer read API base (docs/interfaces/api.openapi.yaml). */
  api: pick(process.env.NEXT_PUBLIC_KRUXA_API, 'http://localhost:8787').replace(/\/$/, ''),
  /** Instant launcher contract (docs/interfaces/INSTANT-ABI.md). Placeholder account until it is deployed. */
  instant: pick(process.env.NEXT_PUBLIC_INSTANT_ACCOUNT, 'instant.kruxa.testnet'),
  /** Kill switch: NEXT_PUBLIC_INSTANT_MODE=0 shows the disabled Instant card in Create. */
  instantEnabled: process.env.NEXT_PUBLIC_INSTANT_MODE !== '0',
  /** Optional relayer that submits buyer-signed Intents messages. Empty means the app shows the signed bundle for self-submission. */
  relayer: pick(process.env.NEXT_PUBLIC_RELAYER_URL, '').replace(/\/$/, ''),
  /** The labelled demo core account (same wasm, relaxed bounds). Empty means the demo profile is not configured in this build. */
  demoCore: pick(process.env.NEXT_PUBLIC_DEMO_CORE_ACCOUNT, ''),
  /** Seeded demo launches, `A:1,B:2,C:3`. Empty means none configured. */
  demoLaunches: pick(process.env.NEXT_PUBLIC_DEMO_LAUNCHES, ''),
} as const;

/** True when the app points at a named stack rather than the undeployed placeholder. */
export const STACK_CONFIGURED = CONFIG.core !== PLACEHOLDER_CORE;

export const USDC_DECIMALS = 6n;
export const fmtUsdc = (micro: string | bigint): string => {
  const n = BigInt(micro);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}$${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''}`;
};

export const explorer = {
  nearTx: (hash: string): string => `https://${NETWORK === 'mainnet' ? '' : 'testnet.'}nearblocks.io/txns/${hash}`,
  nearAccount: (id: string): string => `https://${NETWORK === 'mainnet' ? '' : 'testnet.'}nearblocks.io/address/${id}`,
  solTx: (sig: string, cluster: 'devnet' | 'mainnet' = 'devnet'): string => `https://explorer.solana.com/tx/${sig}${cluster === 'devnet' ? '?cluster=devnet' : ''}`,
  solAddress: (a: string, cluster: 'devnet' | 'mainnet' = 'devnet'): string => `https://explorer.solana.com/address/${a}${cluster === 'devnet' ? '?cluster=devnet' : ''}`,
};
