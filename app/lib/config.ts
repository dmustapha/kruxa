// Single place that reads configuration. Mainnet is refused without Dami's per-action confirmation token.
const env = (k: string, d = ''): string => (typeof process !== 'undefined' ? process.env[k] : undefined) ?? d;

export const NETWORK = env('NEXT_PUBLIC_NEAR_NETWORK', 'testnet');

if (NETWORK === 'mainnet' && env('NEXT_PUBLIC_MAINNET_CONFIRMED') !== 'DAMI-PER-ACTION-CONFIRMED') {
  throw new Error('R_MAINNET_GATE: mainnet needs Dami per-action confirmation; refusing to start');
}

export const CONFIG = {
  network: NETWORK,
  rpcUrl: env('NEXT_PUBLIC_NEAR_RPC', 'https://rpc.testnet.near.org'),
  core: env('NEXT_PUBLIC_CORE_ACCOUNT', 'core.kruxa.testnet'),
  usdc: env('NEXT_PUBLIC_USDC_ACCOUNT', 'usdc.kruxa.testnet'),
  intents: env('NEXT_PUBLIC_INTENTS_ACCOUNT', 'intents.kruxa.testnet'),
  factory: env('NEXT_PUBLIC_FACTORY_ACCOUNT', 'factory.kruxa.testnet'),
} as const;

export const USDC_DECIMALS = 6n;
export const fmtUsdc = (micro: string | bigint): string => {
  const n = BigInt(micro);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `$${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''}`;
};
