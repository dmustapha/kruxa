'use client';
// Verify tab: recompute the verdict, the inputs hash and the allocation in this browser from the core contract's public views, and
// compare them with what the contract stored. The tamper toggle flips one unit of total_active and must turn the result into MISMATCH.
// An unreachable RPC is UNAVAILABLE, never MISMATCH.
import { useCallback, useMemo, useState } from 'react';
import { fetchVerify } from '@/lib/market/api';
import { bookHashCheck, readSnapshot, recompute, summarize, verifyCommand, type ChainReaders, type ChainSnapshot, type Check, type CheckStatus } from '@/lib/market/verify';
import { CopyButton } from './CopyButton';
import { Panel } from './shared';

type Snap = { status: 'idle' } | { status: 'loading' } | { status: 'unavailable'; message: string } | { status: 'ok'; snapshot: ChainSnapshot; indexerBook: string | null };

const MARK: Record<CheckStatus, { glyph: string; cls: string }> = { MATCH: { glyph: '✓', cls: 'mkt-up' }, MISMATCH: { glyph: '✕', cls: 'mkt-down' }, PENDING: { glyph: '…', cls: 'mkt-warn' }, UNAVAILABLE: { glyph: '?', cls: 'mkt-muted' } };

async function defaultReaders(): Promise<ChainReaders> {
  const n = await import('@/lib/near');
  return {
    getVerdictInputs: (id) => n.getVerdictInputs(id),
    getState: (id) => n.getState(id),
    getSettlement: (id) => n.getSettlement(id),
    getCharter: (id) => n.getCharter(id),
  };
}

export function VerifyPanel({ launchId, readers }: { launchId: string; readers?: ChainReaders }) {
  const [snap, setSnap] = useState<Snap>({ status: 'idle' });
  const [tamper, setTamper] = useState(false);

  const run = useCallback(async () => {
    setSnap({ status: 'loading' });
    const [chain, idx] = await Promise.all([
      defaultReadersOr(readers).then((r) => readSnapshot(launchId, r)),
      fetchVerify(launchId).then((d) => d.book_hash_folded, () => null),
    ]);
    setSnap(chain.status === 'ok' ? { status: 'ok', snapshot: chain.snapshot, indexerBook: idx } : { status: 'unavailable', message: chain.message });
  }, [launchId, readers]);

  const checks: Check[] = useMemo(() => (snap.status === 'ok' ? [...recompute(snap.snapshot, tamper), bookHashCheck(snap.indexerBook, snap.snapshot.bookHash)] : []), [snap, tamper]);
  const overall = checks.length ? summarize(checks) : null;

  return (
    <Panel title="Verify this launch" id="mkt-verify-h">
      <p className="mkt-note" style={{ marginTop: 0 }}>This reads the core contract&apos;s public views over RPC and recomputes the verdict, the inputs hash and the allocation here, in your browser. You do not have to trust this page or the indexer.</p>
      <div className="mkt-verify-actions">
        <button type="button" className="mkt-btn" onClick={() => void run()} disabled={snap.status === 'loading'} aria-busy={snap.status === 'loading' || undefined}>
          {snap.status === 'loading' ? 'Reading the contract...' : snap.status === 'idle' ? 'Recompute in your browser' : 'Recompute again'}
        </button>
        <label className="mkt-check">
          <input type="checkbox" checked={tamper} onChange={(e) => setTamper(e.target.checked)} />
          <span>Try a tamper: add 1 unit to total_active before recomputing. The result must be MISMATCH.</span>
        </label>
      </div>
      <div role="status" aria-live="polite">
        {snap.status === 'unavailable' && <div className="mkt-alert" data-tone="warn"><strong>UNAVAILABLE</strong>{snap.message} This is not a mismatch: nothing could be compared.</div>}
        {overall && <p className={`mkt-overall ${MARK[overall].cls}`}><span aria-hidden="true">{MARK[overall].glyph} </span>{overall}{tamper && overall === 'MISMATCH' ? ' (expected: tamper is on)' : ''}</p>}
      </div>
      {checks.length > 0 && (
        <div className="mkt-tablewrap">
          <table className="mkt-table">
            <caption className="mkt-sr">Recompute results</caption>
            <thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Recomputed</th><th scope="col">Stored</th></tr></thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.id}>
                  <td>{c.id} {c.label}{c.note && <span className="mkt-note" style={{ display: 'block' }}>{c.note}</span>}</td>
                  <td className={MARK[c.status].cls}><span aria-hidden="true">{MARK[c.status].glyph} </span>{c.status}</td>
                  <td className="mkt-mono mkt-wrap">{c.recomputed ?? 'n/a'}</td>
                  <td className="mkt-mono mkt-wrap">{c.stored ?? 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="mkt-h3">Check it outside this page</h3>
      <div className="mkt-cmd"><code>{verifyCommand(launchId)}</code><CopyButton text={verifyCommand(launchId)} label="the verify command" /></div>
      <p className="mkt-note">Add <code>--tamper-all</code> to see every check fail on a one-unit change. Exit code 0 means every check matched.</p>
      <p className="mkt-note"><a href={`/launch/${encodeURIComponent(launchId)}/verify`}>Open the full verification page</a></p>
    </Panel>
  );
}

const defaultReadersOr = async (r?: ChainReaders): Promise<ChainReaders> => r ?? defaultReaders();
