// Token-page variant of the genesis stepper (trial launches only). Steps come from the launch timeline (receipts), the `genesis` object
// (OpenAPI 1.1.0: stage none, pending, committed, confirmed) and the pool state. A step the data does not cover is `unknown`, never `done`.
import type { EventRef, GenesisInfo, LaunchDetail, TokenPageData } from './types';

export type StepState = 'done' | 'current' | 'pending' | 'unknown' | 'skipped';
export interface GenesisStep { id: string; label: string; state: StepState; note?: string; receipt?: string }

const event = (d: LaunchDetail | undefined, ...names: string[]): EventRef | undefined => d?.timeline?.find((e) => names.includes(e.event));
const rank = (g: GenesisInfo | null | undefined): number => (g ? ['none', 'pending', 'committed', 'confirmed'].indexOf(g.stage) : -1);

export function genesisSteps(page: TokenPageData, detail: LaunchDetail | undefined, poolAwaitingToken: boolean): GenesisStep[] {
  const g = page.genesis ?? detail?.genesis ?? null;
  const r = rank(g);
  const net = g?.network ? ` (${g.network}${g.path ? `, ${g.path}` : ''})` : '';
  const verdict = event(detail, 'verdict');
  const settled = event(detail, 'settled', 'pass_allocated');
  const solana = (need: number, id: string, label: string, note: string, extra = true): GenesisStep => ({
    id, label, state: r < 0 ? 'unknown' : r >= need && extra ? 'done' : 'pending', note: r < 0 ? 'Not reported by the indexer yet.' : r >= need && extra ? note + net : undefined,
  });
  const authNull = g?.mint_authority === 'null' && g?.freeze_authority === 'null';
  const steps: GenesisStep[] = [
    { id: 'verdict', label: 'NEAR verdict: PASS', state: page.launch.verdict === 'PASS' ? 'done' : 'unknown', receipt: verdict?.receipt_id, note: page.launch.verdict === 'PASS' ? 'Recorded by the core contract.' : undefined },
    { id: 'settled', label: 'Settled and allocated', state: settled ? 'done' : detail ? 'pending' : 'unknown', receipt: settled?.receipt_id },
    solana(2, 'committed', 'Genesis spec committed', g?.spec_hash ? `Spec hash ${g.spec_hash.slice(0, 12)}...` : 'Committed.'),
    solana(3, 'confirmed', 'Solana mint created, authorities None', g?.mint ? `Mint ${g.mint.slice(0, 8)}...` : 'Created.', authNull),
    { id: 'distributor', label: 'Distribution root set', state: g?.root ? 'done' : r < 0 ? 'unknown' : 'pending', note: g?.root ? `Root ${g.root.slice(0, 12)}...${net}` : r < 0 ? 'Not reported by the indexer yet.' : undefined },
    { id: 'pool', label: 'NEAR pool seeded', state: page.pool.open ? 'done' : poolAwaitingToken ? 'current' : 'pending', note: poolAwaitingToken ? 'One of the two seed legs has landed; the pool is being seeded.' : undefined },
    { id: 'trading', label: 'Trading', state: page.pool.open ? 'done' : 'pending' },
  ];
  if (!steps.some((s) => s.state === 'current')) {
    const i = steps.findIndex((s) => s.state === 'pending');
    if (i >= 0) steps[i] = { ...steps[i]!, state: 'current' };
  }
  return steps;
}
