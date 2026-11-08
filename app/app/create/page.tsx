'use client';
import { useEffect, useState } from 'react';
import { fmtUsdc } from '@/lib/config';
import { requiredDeposit } from '@/lib/near';
import { connect, createTrial } from '@/lib/wallet';

const USDC = 1_000_000;
const defaults = { symbol: '', name: '', hardCap: 1000, softCap: 350, minBuy: 20, minFunders: 10, commitHours: 24, tailHours: 6, streamDays: 30 };

export default function Create() {
  const [f, setF] = useState(defaults);
  const [deposit, setDeposit] = useState<string>('');
  const [error, setError] = useState<string>('');
  const set = (k: keyof typeof defaults) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === 'symbol' || k === 'name' ? e.target.value : Number(e.target.value) });

  const params = {
    symbol: f.symbol.toUpperCase(), name: f.name, total_supply_whole: 1_000_000_000, sale_bps: 6000, lp_bps: 2500, creator_bps: 1000, backer_bps: 500,
    hard_cap: String(f.hardCap * USDC), soft_cap: String(f.softCap * USDC), min_buy: String(f.minBuy * USDC), wallet_bps: 200, min_funders: f.minFunders,
    open_delay_secs: 0, commit_secs: f.commitHours * 3600, tail_secs: f.tailHours * 3600, stream_days: f.streamDays,
  };

  useEffect(() => {
    if (!f.symbol || !f.name) return setDeposit('');
    requiredDeposit(params).then((d) => { setDeposit(d); setError(''); }).catch((e: Error) => { setDeposit(''); setError(e.message.split('\n')[0] ?? 'invalid'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(f)]);

  return (
    <>
      <h1>Create a trial</h1>
      <p>The contract validates every number. A rule violation is returned as a code, for example <code>R_SOFT_CAP</code>, before any wallet prompt.</p>
      <label>Ticker (2-12 of A-Z, 0-9)</label><input value={f.symbol} onChange={set('symbol')} />
      <label>Name</label><input value={f.name} onChange={set('name')} />
      <div className="row">
        {(['hardCap', 'softCap', 'minBuy', 'minFunders', 'commitHours', 'tailHours', 'streamDays'] as const).map((k) => (
          <div key={k}><label>{k}</label><input type="number" value={f[k]} onChange={set(k)} style={{ width: 120 }} /></div>
        ))}
      </div>
      <div className="card">
        {error ? <span className="bad">{error}</span> : deposit ? <>Creator deposit (refundable storage bond plus factory fee): <b>{(Number(BigInt(deposit) / 10n ** 21n) / 1000).toFixed(3)} NEAR</b> · hard cap {fmtUsdc(BigInt(params.hard_cap))}</> : 'Fill ticker and name to validate.'}
      </div>
      <div className="row">
        <button onClick={() => void connect()}>Connect wallet</button>
        <button disabled={!deposit} onClick={() => void createTrial(params, deposit)}>Create trial</button>
      </div>
    </>
  );
}
