// Token-page variant of the genesis stepper (APP-SPEC section 6). Steps come from the launch timeline (receipts), the optional
// `genesis` object (IR-A4) and the pool state. A step the data does not cover is `unknown`, never `done`.
import type { EventRef, GenesisInfo, LaunchDetail, TokenPageData } from './types';

export type StepState = 'done' | 'current' | 'pending' | 'unknown' | 'skipped';
export interface GenesisStep { id: string; label: string; state: StepState; note?: string; receipt?: string }

const ORDER = ['none', 'spec_committed', 'mint_created', 'authorities_set', 'distributor_set', 'claims_open'];
const reached = (g: GenesisInfo | null | undefined, stage: string): boolean | null => {
  if (!g || !g.stage) return null;
  const have = ORDER.indexOf(g.stage);
  return have < 0 ? null : have >= ORDER.indexOf(stage);
};
const event = (d: LaunchDetail | undefined, ...names: string[]): EventRef | undefined => d?.timeline?.find((e) => names.includes(e.event));

export function genesisSteps(page: TokenPageData, detail: LaunchDetail | undefined, poolAwaitingToken: boolean): GenesisStep[] {
  const g = page.genesis ?? detail?.genesis ?? null;
  const net = g?.network ? ` (${g.network}${g.path ? `, ${g.path}` : ''})` : '';
  const verdict = event(detail, 'verdict');
  const settled = event(detail, 'settled', 'pass_allocated');
  const solana = (stage: string, label: string, note: string): GenesisStep => {
    const r = reached(g, stage);
    return { id: stage, label, state: r === null ? 'unknown' : r ? 'done' : 'pending', note: r === null ? 'Not reported by the indexer yet.' : r ? note + net : undefined };
  };
  const steps: GenesisStep[] = [
    { id: 'verdict', label: 'NEAR verdict: PASS', state: page.launch.verdict === 'PASS' ? 'done' : 'unknown', receipt: verdict?.receipt_id, note: page.launch.verdict === 'PASS' ? 'Recorded by the core contract.' : undefined },
    { id: 'settled', label: 'Settled and allocated', state: settled ? 'done' : detail ? 'pending' : 'unknown', receipt: settled?.receipt_id },
    solana('spec_committed', 'Genesis spec committed', g?.spec_hash ? `Spec hash ${g.spec_hash.slice(0, 12)}...` : 'Committed.'),
    solana('authorities_set', 'Solana mint created, authorities None', g?.mint ? `Mint ${g.mint.slice(0, 8)}...` : 'Created.'),
    solana('distributor_set', 'Distribution root set', 'Root set.'),
    { id: 'pool', label: 'NEAR pool seeded', state: page.pool.open ? 'done' : poolAwaitingToken ? 'current' : 'pending', note: poolAwaitingToken ? 'One of the two seed legs has landed; the pool is being seeded.' : undefined },
    { id: 'trading', label: 'Trading', state: page.pool.open ? 'done' : 'pending' },
  ];
  // The first known-but-not-done step is the current one.
  if (!steps.some((s) => s.state === 'current')) {
    const i = steps.findIndex((s) => s.state === 'pending');
    if (i >= 0) steps[i] = { ...steps[i]!, state: 'current' };
  }
  return steps;
}
