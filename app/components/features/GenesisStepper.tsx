import { Badge } from '@/components/ui/Badges';
import type { GenesisView } from '@/lib/api/types';
import { shortHash } from '@/lib/format';

type StepState = 'done' | 'pending' | 'unknown' | 'none';
interface Step { id: string; label: string; state: StepState; detail: string }

/** NEAR verdict to Solana mint (APP-SPEC section 6). Built from the optional `genesis` object (IR-A4). Until the indexer provides it,
 *  every step after the verdict reads "unknown", never "done". On FAIL the answer is that no Solana mint exists. Shared with the token page. */
export function genesisSteps(verdict: 'PASS' | 'FAIL' | null | undefined, g: GenesisView | null | undefined): Step[] {
  const has = (v: string | null | undefined): StepState => (v ? 'done' : g ? 'pending' : 'unknown');
  return [
    { id: 'verdict', label: 'NEAR verdict is PASS', state: verdict === 'PASS' ? 'done' : 'pending', detail: verdict === 'PASS' ? 'recorded on the core contract' : 'waiting for settle' },
    { id: 'spec', label: 'Genesis spec committed', state: has(g?.spec_hash), detail: g?.spec_hash ? `hash ${shortHash(g.spec_hash)}` : 'spec hash not indexed' },
    { id: 'mint', label: 'Solana mint created', state: has(g?.mint), detail: g?.mint ? `mint ${shortHash(g.mint)}` : 'mint not indexed' },
    { id: 'auth', label: 'Authorities set to None', state: g?.verified_checks?.includes('C7') && g.verified_checks.includes('C8') ? 'done' : g ? 'pending' : 'unknown', detail: 'verify checks C7 and C8 (mint and freeze authority)' },
    { id: 'root', label: 'Distribution root published', state: has(g?.root), detail: g?.root ? `root ${shortHash(g.root)}` : 'root not indexed' },
    { id: 'claims', label: 'Claims open', state: g?.stage === 'claims_open' ? 'done' : g ? 'pending' : 'unknown', detail: 'Solana holders claim with a Merkle proof' },
  ];
}

const MARK: Record<StepState, string> = { done: 'Done', pending: 'Pending', unknown: 'Unknown', none: 'None' };

export function GenesisStepper({ verdict, genesis }: { verdict?: 'PASS' | 'FAIL' | null; genesis?: GenesisView | null }) {
  if (verdict === 'FAIL') {
    return <div className="callout"><p><b>No Solana mint was created for this launch.</b> A failed trial never reaches genesis. The verifier checks this as C30.</p></div>;
  }
  const steps = genesisSteps(verdict, genesis);
  return (
    <div>
      <div className="row between"><span className="hint">{genesis?.network ? `Network: ${genesis.network}` : 'Network: not indexed'}{genesis?.path ? ` · path ${genesis.path}` : ''}</span><Badge tone="muted">{genesis ? 'indexer' : 'indexer has no genesis data yet'}</Badge></div>
      <ol className="tl" aria-label="Genesis on Solana">
        {steps.map((s) => (
          <li key={s.id} aria-current={s.state === 'pending' && steps.findIndex((x) => x.state !== 'done') === steps.indexOf(s) ? 'step' : undefined}>
            <b>{s.label}</b> <Badge tone={s.state === 'done' ? 'pass' : s.state === 'pending' ? 'warn' : 'muted'}>{MARK[s.state]}</Badge>
            <span className="when">{s.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
