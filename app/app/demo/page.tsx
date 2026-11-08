'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { CONFIG } from '@/lib/config';
import { getSettlement, getVerdictInputs } from '@/lib/near';
import { allocate, inputsHash, settlePosition, verdict, type VerdictInputs } from '@/lib/verdict';

const zero = Array<number>(32).fill(0);
const golden: VerdictInputs[] = [
  { launch_id: '1', charter_hash: zero, total_active: '350000000', active_funders: 10, soft_cap: '350000000', min_funders: 10, cancelled: false },
  { launch_id: '1', charter_hash: zero, total_active: '349999999', active_funders: 10, soft_cap: '350000000', min_funders: 10, cancelled: false },
  { launch_id: '1', charter_hash: zero, total_active: '350000000', active_funders: 9, soft_cap: '350000000', min_funders: 10, cancelled: false },
];
const label = (i: VerdictInputs) => { const o = verdict(i); return o.pass ? 'PASS' : `FAIL (reasons ${o.reasons})`; };

function Judge() {
  const q = useSearchParams();
  const [launch, setLaunch] = useState(q.get('launch') ?? '1');
  const [tamper, setTamper] = useState(false);
  const [out, setOut] = useState<string>('');
  const a = useMemo(() => allocate(12_500_000_000n, 5_000_000_000n, 6000n, 2500n), []);
  const p = useMemo(() => settlePosition(100_000_000n, 12_500_000_000n, a.accepted, 600_000_000_000_000n, 50_000_000_000_000n), [a]);

  async function recompute() {
    try {
      const [vi, st] = await Promise.all([getVerdictInputs(launch), getSettlement(launch)]);
      if (!vi || !st) return setOut('No such launch, or not settled yet.');
      const i = vi.inputs as unknown as VerdictInputs;
      const used = tamper ? { ...i, total_active: (BigInt(i.total_active) + 1n).toString() } : i;
      const h = inputsHash(used);
      const match = (verdict(used).pass === st['pass']) && h === st['inputs_hash'];
      setOut(`recomputed ${label(used)} hash ${h}\nstored     pass=${String(st['pass'])} hash ${String(st['inputs_hash'])}\n${match ? 'MATCH' : 'MISMATCH'}`);
    } catch (e) { setOut(`error: ${(e as Error).message}`); }
  }

  return (
    <>
      <h1>Verify without trusting us</h1>
      <p>Everything on this page is computed in your browser by a TypeScript port of the contract&apos;s pure functions. The port is pinned to the Rust output by tests.</p>
      <h2>1. Boundary vectors (offline)</h2>
      <table><tbody>{golden.map((g, k) => <tr key={k}><td>total {g.total_active}, funders {g.active_funders}</td><td>{label(g)}</td><td><code>{inputsHash(g).slice(0, 16)}…</code></td></tr>)}</tbody></table>
      <h2>2. Oversubscribed sale, S1-B example 1 (offline)</h2>
      <p>$12,500 committed against a $5,000 cap: accepted {String(a.accepted)}, fee {String(a.launchFee)}, LP {String(a.lpQuote)}, stream {String(a.stream)}, refund pool {String(a.excessPool)} (micro-USDC). A $100 buyer pays {String(p.spend)} and is refunded {String(p.refund)}.</p>
      <h2>3. A live launch on {CONFIG.network}</h2>
      <div className="row">
        <input value={launch} onChange={(e) => setLaunch(e.target.value)} style={{ width: 90 }} />
        <label style={{ margin: 0 }}><input type="checkbox" checked={tamper} onChange={(e) => setTamper(e.target.checked)} style={{ marginRight: 6 }} />Tamper (+1 unit; must print MISMATCH)</label>
        <button onClick={() => void recompute()}>Recompute</button>
      </div>
      <pre>{out || 'Press Recompute.'}</pre>
    </>
  );
}

export default function DemoPage() {
  return <Suspense fallback={<p>Loading…</p>}><Judge /></Suspense>;
}
