'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import type { Portfolio, PortfolioPosition, PositionStatus } from '@/lib/api/types';
import { WalletActionButton, useWallet } from '@/components/wallet';
import { Badge, SourceBadge, StageBadge } from '@/components/ui/Badges';
import { Freshness } from '@/components/ui/Freshness';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States';
import { TxStatus } from '@/components/ui/TxStatus';
import { FundsStrip } from '../FundsStrip';
import { walkNear } from '@/lib/actions';
import { fmtUsdc } from '@/lib/config';
import { titleCase } from '@/lib/format';
import { allocate, settlePosition } from '@/lib/verdict';
import { getCharter } from '@/lib/near';
import { useHolderKeys } from '@/lib/useHolders';
import { useTx } from '@/lib/useTx';

const TONE: Record<PositionStatus, string> = { active: 'open', walked: 'muted', awaiting_settle: 'warn', refundable: 'warn', claimable: 'pass', claimed: 'muted', market_only: 'source' };

/** Tokens the position would receive if the trial closed now AND passed. Derived from the Charter over RPC with the contract's own integer rules. */
function TokensIfClosedNow({ p }: { p: PortfolioPosition }) {
  const s = useApi(async () => {
    const ch = await getCharter(p.launch.launch_id);
    if (!ch) throw new Error('no charter');
    return ch;
  }, `ch-${p.launch.launch_id}`);
  if (s.status === 'loading') return <span className="muted">reading Charter</span>;
  if (s.status !== 'ok') return <span className="muted">needs the NEAR RPC (interface request IR-2: a preview_settlement view)</span>;
  const total = BigInt(p.launch.total_active);
  if (total === 0n) return <span className="muted">n/a</span>;
  const a = allocate(total, BigInt(String(s.data.params['hard_cap'])), BigInt(String(s.data.params['sale_bps'])), BigInt(String(s.data.params['lp_bps'])));
  const nSale = BigInt(String(s.data.derived['n_sale'] ?? 0));
  const nBacker = BigInt(String(s.data.derived['n_backer'] ?? 0));
  const r = settlePosition(BigInt(p.active ?? p.contributed), total, a.accepted, nSale, nBacker);
  return <span className="num">{r.tokens.toString()} base units, you spend {fmtUsdc(r.spend)} and are refunded {fmtUsdc(r.refund)}</span>;
}

function WalkButton({ p }: { p: PortfolioPosition }) {
  const { adapters } = useWallet();
  const tx = useTx();
  const can = p.launch.status === 'open' && BigInt(p.active ?? '0') > 0n;
  return (
    <div>
      <WalletActionButton action="walk" disabled={!can} loading={tx.state.status === 'pending'}
        onReady={(d) => { if (d.path === 'near-native') void tx.run(() => adapters.near.signAndSendTransaction(walkNear(p.launch.launch_id))); }}>Walk</WalletActionButton>
      <TxStatus state={tx.state} />
    </div>
  );
}

function PositionCard({ p }: { p: PortfolioPosition }) {
  const open = p.launch.stage === 'new' || p.launch.stage === 'open' || p.launch.stage === 'closing';
  return (
    <article className="card" aria-label={`Position in ${p.launch.symbol}`}>
      <div className="row between">
        <h3 style={{ margin: 0 }}><Link href={`/launch/${p.launch.launch_id}`}>{p.launch.symbol} #{p.launch.launch_id}</Link></h3>
        <span className="row"><StageBadge stage={p.launch.stage} /><Badge tone={TONE[p.status]}>{titleCase(p.status)}</Badge><SourceBadge source={p.launch.source} /></span>
      </div>
      <dl className="kv">
        <div><dt>Contributed</dt><dd>{fmtUsdc(p.contributed)}</dd></div>
        <div><dt>Walked</dt><dd>{fmtUsdc(p.walked)}</dd></div>
        <div><dt>Still active</dt><dd>{fmtUsdc(p.active ?? '0')}</dd></div>
        <div><dt>Tokens claimed</dt><dd>{p.tokens_claimed ?? '0'}</dd></div>
        {p.market_balance && <div><dt>Market balance</dt><dd>{p.market_balance}{p.market_value_quote != null ? ` (about ${p.market_value_quote.toFixed(4)} USDC at the last pool price)` : ''}</dd></div>}
        {open && <div><dt>Tokens if closed now and PASS</dt><dd><TokensIfClosedNow p={p} /></dd></div>}
      </dl>
      {open && <WalkButton p={p} />}
    </article>
  );
}

export function PortfolioView() {
  const holders = useHolderKeys();
  const [lookup, setLookup] = useState('');
  const [applied, setApplied] = useState('');
  const keys = applied ? [applied] : holders.keys;
  const s = useApi<Portfolio[]>(keys.length ? () => Promise.all(keys.map((k) => api.portfolio(k))) : null, `pf-${keys.join(',')}`, 20000);
  const positions = s.status === 'ok' ? s.data.flatMap((p) => p.positions) : [];
  const funds = s.status === 'ok' ? s.data.flatMap((p) => p.funds_in_motion) : undefined;
  const first = s.status === 'ok' ? s.data[0] : undefined;

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Positions</p>
        <h1>Portfolio</h1>
        <p className="lede">Your positions, what they would be worth in tokens if a trial closed now, funds still in motion, and claims. A wallet is needed only to act.</p>
      </header>
      <form className="card" onSubmit={(e) => { e.preventDefault(); setApplied(lookup.trim()); }} aria-label="Look up an account">
        <label htmlFor="acct" style={{ marginTop: 0 }}>Look up any account (read only)</label>
        <div className="row"><input id="acct" style={{ flex: '1 1 260px', width: 'auto' }} value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="alice.testnet or sol:<address>" autoComplete="off" autoCapitalize="none" spellCheck={false} />
          <button type="submit" disabled={!lookup.trim()}>Look up</button>{applied && <button type="button" className="btn-quiet" onClick={() => { setApplied(''); setLookup(''); }}>Use my wallet</button>}</div>
        <p className="hint">{applied ? `Showing ${applied}.` : holders.keys.length ? `Showing your connected account: ${holders.keys.join(', ')}.` : 'No wallet connected. Enter an account to read its positions.'}</p>
      </form>

      {keys.length === 0 && <EmptyState title="Nothing to show yet">Look up an account above, or connect a wallet from any action button.</EmptyState>}
      {s.status === 'loading' && <LoadingBlock label="Loading portfolio" />}
      {s.status === 'error' && <ErrorState error={s.error} what="the portfolio" onRetry={s.reload} />}
      {s.status === 'ok' && (
        <>
          <div style={{ margin: '8px 0 16px' }}><Freshness source={first?.source} asOf={first?.as_of} /></div>
          {positions.length === 0
            ? <EmptyState title="No positions for this account" action={<Link className="btn" href="/launches">Browse launches</Link>}>The indexer has no commit, Walk or market balance for it.</EmptyState>
            : <div className="grid grid-2">{positions.map((p) => <PositionCard key={p.launch.launch_id} p={p} />)}</div>}
        </>
      )}
      <FundsStrip items={funds} keys={keys} loading={s.status === 'loading'} error={s.status === 'error' ? s.error.message : null} />
    </>
  );
}
