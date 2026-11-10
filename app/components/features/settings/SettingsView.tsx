'use client';
import { useState } from 'react';
import { useWallet } from '@/components/wallet';
import { clearLocalData } from '@/lib/settings';
import { useHiddenTokens, useSettings, useWatchlist } from '@/lib/useSettings';
import { parseSlippagePct } from '@/lib/market/quote';
import { shortAccount } from '@/lib/format';

const SLIP = ['0.5', '1', '3'];

function Trading() {
  const [s, update] = useSettings();
  const [presets, setPresets] = useState<string | null>(null);
  const shown = presets ?? s.buyPresets.join(', ');
  const parsed = shown.split(',').map((x) => Number(x.trim()));
  const presetsOk = parsed.length === 3 && parsed.every((n) => Number.isInteger(n) && n >= 1 && n <= 1_000_000);
  const slipOk = parseSlippagePct(s.slippagePct) !== null;
  return (
    <section className="card" aria-labelledby="set-trade-h">
      <h2 id="set-trade-h">Trading defaults</h2>
      <fieldset className="seg" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="hint">Default max slippage (sets the minimum you accept on a trade)</legend>
        {SLIP.map((p) => <button key={p} type="button" aria-pressed={s.slippagePct === p} onClick={() => update({ slippagePct: p })}>{p}%</button>)}
        <input aria-label="Custom slippage percent" inputMode="decimal" style={{ width: 90 }} value={s.slippagePct} aria-invalid={!slipOk || undefined} onChange={(e) => update({ slippagePct: e.target.value })} />
      </fieldset>
      {!slipOk && <p className="bad" role="alert">Use a number from 0.1 to 50. Until you do, the default of 1% applies.</p>}
      <label htmlFor="set-presets">Buy preset amounts in USDC (three whole numbers, comma separated)</label>
      <input id="set-presets" value={shown} aria-invalid={!presetsOk || undefined} onChange={(e) => { setPresets(e.target.value); const n = e.target.value.split(',').map((x) => Number(x.trim())); if (n.length === 3 && n.every((v) => Number.isInteger(v) && v >= 1 && v <= 1_000_000)) update({ buyPresets: n }); }} />
      {!presetsOk && <p className="bad" role="alert">Enter exactly three whole numbers, for example 5, 25, 100.</p>}
    </section>
  );
}

function Network() {
  const [s, update] = useSettings();
  const bad = (v: string): boolean => v !== '' && !/^https:\/\/\S{3,200}$/.test(v);
  const [near, setNear] = useState<string | null>(null);
  const [sol, setSol] = useState<string | null>(null);
  const nearV = near ?? s.nearRpc; const solV = sol ?? s.solanaRpc;
  return (
    <section className="card" aria-labelledby="set-net-h">
      <h2 id="set-net-h">Network endpoints</h2>
      <p className="hint">Optional. Used by Verify and by direct chain reads in this browser. Leave empty for the defaults. Only https addresses are kept. Signing never uses these.</p>
      <label htmlFor="set-near">NEAR RPC address</label>
      <input id="set-near" value={nearV} placeholder="https://rpc.testnet.near.org" autoComplete="off" spellCheck={false} aria-invalid={bad(nearV) || undefined} onChange={(e) => { setNear(e.target.value); if (!bad(e.target.value)) update({ nearRpc: e.target.value.trim() }); }} />
      <label htmlFor="set-sol">Solana RPC address</label>
      <input id="set-sol" value={solV} placeholder="https://api.devnet.solana.com" autoComplete="off" spellCheck={false} aria-invalid={bad(solV) || undefined} onChange={(e) => { setSol(e.target.value); if (!bad(e.target.value)) update({ solanaRpc: e.target.value.trim() }); }} />
      {(bad(nearV) || bad(solV)) && <p className="bad" role="alert">That is not an https address, so it was not saved.</p>}
    </section>
  );
}

function Display() {
  const [s, update] = useSettings();
  return (
    <section className="card" aria-labelledby="set-disp-h">
      <h2 id="set-disp-h">Display</h2>
      <div className="seg" role="group" aria-label="Time display">
        <button type="button" aria-pressed={s.timeDisplay === 'utc'} onClick={() => update({ timeDisplay: 'utc' })}>UTC</button>
        <button type="button" aria-pressed={s.timeDisplay === 'local'} onClick={() => update({ timeDisplay: 'local' })}>My time zone</button>
      </div>
      <label className="inline"><input type="checkbox" checked={s.reducedMotion} onChange={(e) => update({ reducedMotion: e.target.checked })} /> Reduce motion (your system setting is always respected too)</label>
      <label className="inline"><input type="checkbox" checked={s.showFixture} onChange={(e) => update({ showFixture: e.target.checked })} /> Show fixture data (always labelled FIXTURE DATA)</label>
    </section>
  );
}

function Wallets() {
  const { sessions, disconnect } = useWallet();
  const rows = [['NEAR', sessions.near] as const, ['Solana', sessions.solana] as const];
  return (
    <section className="card" aria-labelledby="set-wal-h">
      <h2 id="set-wal-h">Connected wallets</h2>
      {rows.map(([name, ses]) => (
        <div key={name} className="row between" style={{ minHeight: 44 }}>
          <span>{name}: {ses ? <b className="mono">{shortAccount(ses.address)} ({ses.walletName})</b> : <span className="muted">not connected</span>}</span>
          {ses && <button type="button" className="btn-quiet" onClick={() => void disconnect(name === 'NEAR' ? 'near' : 'solana')}>Disconnect {name}</button>}
        </div>
      ))}
      <p className="hint">Browsing and verifying never ask for a wallet. There is no account and no email.</p>
    </section>
  );
}

function LocalData() {
  const [watch, , clearWatch] = useWatchlist();
  const [hidden, , clearHidden] = useHiddenTokens();
  const [, , reset] = useSettings();
  const [done, setDone] = useState(false);
  return (
    <section className="card" aria-labelledby="set-data-h">
      <h2 id="set-data-h">Your local data</h2>
      <p>Everything on this page is stored in this browser only. Nothing is sent to Kruxa.</p>
      <dl className="kv"><div><dt>Watchlist</dt><dd>{watch.length} launches</dd></div><div><dt>Hidden from my feed</dt><dd>{hidden.length} launches</dd></div></dl>
      <p className="hint">Hiding a launch only removes it from your own Discover list. It is not a moderation action and changes nothing for anyone else.</p>
      <div className="row">
        <button type="button" className="btn-danger" onClick={() => { clearLocalData(); clearWatch(); clearHidden(); reset(); setDone(true); }}>Clear local data</button>
        {done && <span role="status" className="ok">Cleared.</span>}
      </div>
    </section>
  );
}

export function SettingsView() {
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Preferences</p>
        <h1>Settings</h1>
        <p className="lede">Local to this browser. If your browser blocks storage, the app still works and simply forgets these.</p>
      </header>
      <div className="stack"><Trading /><Network /><Display /><Wallets /><LocalData /></div>
    </>
  );
}
