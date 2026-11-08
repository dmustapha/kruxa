import { explorer } from '@/lib/config';

type Kind = 'near-tx' | 'near-account' | 'sol-tx' | 'sol-address';

export function ExplorerLink({ kind, value, cluster = 'devnet', chars = 10 }: { kind: Kind; value: string; cluster?: 'devnet' | 'mainnet'; chars?: number }) {
  const href = kind === 'near-tx' ? explorer.nearTx(value) : kind === 'near-account' ? explorer.nearAccount(value)
    : kind === 'sol-tx' ? explorer.solTx(value, cluster) : explorer.solAddress(value, cluster);
  const mainnetNear = kind.startsWith('near') && cluster === 'mainnet';
  const url = mainnetNear ? href.replace('testnet.', '') : href;
  const text = value.length > chars * 2 + 3 ? `${value.slice(0, chars)}...${value.slice(-chars)}` : value;
  return <a className="mono" href={url} target="_blank" rel="noreferrer noopener" title={value}>{text}<span className="sr-only"> (opens the explorer in a new tab)</span></a>;
}
