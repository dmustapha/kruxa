'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { Badge, SourceBadge } from '@/components/ui/Badges';
import { CommandBlock } from '@/components/ui/CopyButton';
import { ErrorState, LoadingBlock } from '@/components/ui/States';
import { getCharter, getSettlement, getState, getVerdictInputs, type Settlement } from '@/lib/near';
import { bookHashCheck, recompute, summarize, type Check, type CheckStatus } from '@/lib/verify';
import type { VerdictInputs } from '@/lib/verdict';
import type { VerifyData } from '@/lib/api/types';
import { ApiError } from '@/lib/api/client';

type Snap =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'ok'; inputs: VerdictInputs; storedHash: string; settlement: Settlement | null; bookHash: string; charter: { sale_bps: number; lp_bps: number; hard_cap: string } };

const TONE: Record<CheckStatus, string> = { MATCH: 'match', MISMATCH: 'mismatch', PENDING: 'pending', UNAVAILABLE: 'muted' };

async function readChain(id: string): Promise<Snap> {
  try {
    const [vi, st, settlement, charter] = await Promise.all([getVerdictInputs(id), getState(id), getSettlement(id) as Promise<Settlement | null>, getCharter(id)]);
    if (!vi || !st || !charter) return { status: 'unavailable', message: `The contract has no launch ${id} (or the RPC returned nothing).` };
    return {
      status: 'ok', inputs: vi.inputs as unknown as VerdictInputs, storedHash: vi.inputs_hash, settlement, bookHash: st.book_hash,
      charter: { sale_bps: Number(charter.params['sale_bps']), lp_bps: Number(charter.params['lp_bps']), hard_cap: String(charter.params['hard_cap']) },
    };
  } catch (e) {
    return { status: 'unavailable', message: (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? 'RPC failed' };
  }
}

export function VerifyView() {
  const { id } = useParams<{ id: string }>();
  const [snap, setSnap] = useState<Snap>({ status: 'loading' });
  const [idx, setIdx] = useState<{ status: 'loading' } | { status: 'ok'; data: VerifyData } | { status: 'error'; error: ApiError }>({ status: 'loading' });
  const [tamper, setTamper] = useState(false);
  const load = useCallback(() => {
    setSnap({ status: 'loading' }); setIdx({ status: 'loading' });
    void readChain(id).then(setSnap);
    api.verify(id).then((data) => setIdx({ status: 'ok', data }), (e: unknown) => setIdx({ status: 'error', error: e instanceof ApiError ? e : new ApiError('unreachable', 'Request failed.') }));
  }, [id]);
  useEffect(load, [load]);

  const checks: Check[] = snap.status === 'ok'
    ? [
      ...recompute({ inputs: snap.inputs, storedInputsHash: snap.storedHash, settlement: snap.settlement, state: { total_active: snap.inputs.total_active, active_funders: snap.inputs.active_funders, book_hash: snap.bookHash }, charter: snap.charter }, { tamper }),
      bookHashCheck(idx.status === 'ok' ? idx.data.book_hash_folded : null, snap.bookHash),
    ]
    : [];
  const overall = checks.length ? summarize(checks) : null;
  const command = `./scripts/verify.sh ${id}`;

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Launch #{id} · verification</p>
        <h1>Check it without trusting us.</h1>
        <p className="lede">This page reads the contract&apos;s public views from the NEAR RPC and recomputes the verdict in your browser with a TypeScript port of the contract&apos;s pure rules. It prints MATCH or MISMATCH. An unreachable RPC is shown as unavailable, never as a mismatch.</p>
        <p><Link href={`/launch/${id}`}>Back to the trial page</Link></p>
      </header>

      {snap.status === 'loading' && <LoadingBlock label="Reading the contract" />}
      {snap.status === 'unavailable' && (
        <div role="alert" className="state state-error"><h3>Could not read the chain</h3><p>{snap.message}</p><button type="button" onClick={load}>Try again</button><p className="hint">Offline? Use the command below, or the boundary vectors on the <Link href="/demo">demo page</Link>.</p></div>
      )}
      {snap.status === 'ok' && (
        <section className="card" aria-labelledby="res-h">
          <div className="row between"><h2 id="res-h" style={{ margin: 0 }}>Result</h2>{overall && <Badge tone={TONE[overall]}>{overall}</Badge>}</div>
          <label className="inline" style={{ marginTop: 8 }}><input type="checkbox" checked={tamper} onChange={(e) => setTamper(e.target.checked)} />Tamper: add 1 unit to total committed before recomputing (must print MISMATCH)</label>
          <div className="tbl-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Check</th><th>Result</th><th>Recomputed</th><th>Stored</th></tr></thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.id}</b> {c.label}{c.note && <div className="hint">{c.note}</div>}</td>
                    <td><Badge tone={TONE[c.status]}>{c.status}</Badge></td>
                    <td className="mono" style={{ overflowWrap: 'anywhere' }}>{c.recomputed ?? ''}</td>
                    <td className="mono" style={{ overflowWrap: 'anywhere' }}>{c.stored ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Inputs read from the contract: total committed {snap.inputs.total_active}, backers {snap.inputs.active_funders}, soft cap {snap.inputs.soft_cap}, minimum backers {snap.inputs.min_funders} (micro-USDC where it is money).</p>
        </section>
      )}

      <section className="card" aria-labelledby="idx-h">
        <h2 id="idx-h" style={{ marginTop: 0 }}>Indexer cross-reference</h2>
        {idx.status === 'loading' && <p>Reading the indexer.</p>}
        {idx.status === 'error' && <ErrorState error={idx.error} what="indexer verify data" onRetry={load} />}
        {idx.status === 'ok' && (
          <>
            <div className="row"><SourceBadge source={idx.data.source} /><Badge tone={idx.data.ledger_consistent ? 'match' : 'mismatch'}>{idx.data.ledger_consistent ? 'Indexed book is internally consistent' : 'Indexed book is inconsistent'}</Badge></div>
            <p className="hint">{idx.data.fold_note ?? 'The indexer does not recompute the book hash; it quotes the contract\'s own logged value.'}</p>
            <dl className="kv"><div><dt>Charter hash</dt><dd>{idx.data.charter_hash}</dd></div><div><dt>Book events folded</dt><dd>{idx.data.book_events ?? 'n/a'}</dd></div><div><dt>Events referenced</dt><dd>{idx.data.event_count ?? idx.data.events.length}</dd></div></dl>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="sh-h">
        <h2 id="sh-h" style={{ marginTop: 0 }}>The independent check: scripts/verify.sh</h2>
        <p>Run it from a clone of the repository. Exit 0 means every check matched; exit 2 means only a MISMATCH; 4 means an RPC or view failure.</p>
        <CommandBlock label="Full run" command={command} />
        <CommandBlock label="Prove the check can fail" command={`${command} --tamper-all`} />
        <div className="callout info"><p><b>No recorded run yet.</b> No output of verify.sh against a deployed launch is committed (PD-12), so none is shown here. The table above is this page&apos;s own recomputation, not a copy of that script&apos;s output, and the C1 to C34 check table appears only from a committed run.</p></div>
      </section>
    </>
  );
}
