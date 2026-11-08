'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badges';
import { checksFor, overallOf, readChain } from '@/lib/verifyChain';
import type { CheckStatus } from '@/lib/verify';

const TONE: Record<CheckStatus, string> = { MATCH: 'match', MISMATCH: 'mismatch', PENDING: 'pending', UNAVAILABLE: 'muted' };

/** Runs the browser recompute for one launch on demand and shows the answer in place. Exported for the token page (APP-SPEC section 3). */
export function RecomputeButton({ launchId, indexerBookHash }: { launchId: string; indexerBookHash?: string | null }) {
  const [state, setState] = useState<{ status: 'idle' } | { status: 'running' } | { status: 'done'; overall: CheckStatus; detail: string }>({ status: 'idle' });
  async function run() {
    setState({ status: 'running' });
    const snap = await readChain(launchId);
    if (snap.status !== 'ok') { setState({ status: 'done', overall: 'UNAVAILABLE', detail: snap.message }); return; }
    const checks = checksFor(snap, indexerBookHash ?? null, false);
    const overall = overallOf(checks) ?? 'UNAVAILABLE';
    setState({ status: 'done', overall, detail: checks.map((c) => `${c.id} ${c.status}`).join(' · ') });
  }
  return (
    <div>
      <div className="row">
        <button type="button" onClick={() => void run()} disabled={state.status === 'running'} aria-busy={state.status === 'running' || undefined}>{state.status === 'running' ? 'Recomputing' : 'Recompute in your browser'}</button>
        <Link href={`/launch/${launchId}/verify`}>Full check and tamper test</Link>
      </div>
      <div role="status" aria-live="polite" className="hint">
        {state.status === 'done' && <><Badge tone={TONE[state.overall]}>{state.overall}</Badge> {state.detail}{state.overall === 'UNAVAILABLE' ? ' (an unreachable RPC is never a mismatch)' : ''}</>}
      </div>
    </div>
  );
}
