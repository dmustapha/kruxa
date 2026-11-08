'use client';
import Link from 'next/link';
import { useState } from 'react';
import { WalletActionButton, useWallet } from '@/components/wallet';
import { Badge, SourceBadge, StageBadge } from '@/components/ui/Badges';
import { Freshness } from '@/components/ui/Freshness';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States';
import { TxStatus } from '@/components/ui/TxStatus';
import { api, creatorCsvUrl } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import type { CreatorLaunch } from '@/lib/api/types';
import { claimMarketFees } from '@/lib/actions';
import { fmtUsdc } from '@/lib/config';
import { fmtDate, titleCase } from '@/lib/format';
import { creatorStatus, usdcRegistered } from '@/lib/near';
import { useTx } from '@/lib/useTx';
import { StreamPanel } from './StreamPanel';
import { VestPanel } from '../instant/VestPanel';
import { ModeBadge } from '@/components/ui/PhaseBadge';

function Registration({ account }: { account: string }) {
  const s = useApi(() => usdcRegistered(account), `reg-${account}`);
  if (s.status === 'loading') return <Badge tone="muted">Checking USDC registration</Badge>;
  if (s.status === 'error') return <Badge tone="muted" title="The NEAR RPC could not be read">USDC registration unknown</Badge>;
  if (s.status !== 'ok') return null;
  return s.data ? <Badge tone="pass">Registered on USDC</Badge> : <Badge tone="fail" title="Payouts to this account will fail until it is registered on the USDC contract">Not registered on USDC</Badge>;
}

function FeesPanel({ c, canAct }: { c: CreatorLaunch; canAct: boolean }) {
  const { adapters } = useWallet();
  const tx = useTx();
  const chain = useApi(c.launch.has_market ? () => creatorStatus(c.launch.launch_id) : null, `cs-${c.launch.launch_id}`, 20000);
  if (!c.launch.has_market) return <p className="hint">No pool yet, so no trading fees accrue. Fee claims appear here once the token trades on Kruxa&apos;s pool.</p>;
  const claimable = chain.status === 'ok' && chain.data ? chain.data.claimable : c.earnings.claimable_estimate ?? '0';
  return (
    <div className="stack">
      <dl className="kv">
        <div><dt>Creator slice accrued (indexer)</dt><dd>{fmtUsdc(c.earnings.market_fees_creator_slice ?? '0')}</dd></div>
        <div><dt>Claimed</dt><dd>{fmtUsdc(c.earnings.claimed ?? '0')}</dd></div>
        <div><dt>Claimable {chain.status === 'ok' && chain.data ? '(chain read: creator_status)' : '(indexer estimate)'}</dt><dd>{fmtUsdc(claimable)}</dd></div>
      </dl>
      <WalletActionButton action="claim" disabled={!canAct || BigInt(claimable) < 1_000_000n} loading={tx.state.status === 'pending'}
        onReady={(d) => { if (d.path === 'near-native') void tx.run(() => adapters.near.signAndSendTransaction(claimMarketFees(c.launch.launch_id))); }}>Claim fees</WalletActionButton>
      <p className="hint">Pull based, minimum $1. A fee share is vesting-limited and capped by the contract; it is not a promise of income.</p>
      <TxStatus state={tx.state} />
    </div>
  );
}

function LaunchDesk({ c, account }: { c: CreatorLaunch; account: string }) {
  const { sessions } = useWallet();
  const recipient = c.launch.payout_recipient;
  const canAct = sessions.near?.address === recipient;
  return (
    <article className="card" aria-label={`Creator desk for ${c.launch.symbol}`}>
      <div className="row between">
        <h2 style={{ margin: 0 }}><Link href={`/launch/${c.launch.launch_id}`}>{c.launch.symbol} #{c.launch.launch_id}</Link></h2>
        <span className="row"><StageBadge stage={c.launch.stage} /><ModeBadge mode={c.launch.mode} /><Badge tone="muted">{titleCase(c.role)}</Badge><SourceBadge source={c.launch.source} /></span>
      </div>
      <dl className="kv">
        <div><dt>Creator</dt><dd>{c.launch.creator}</dd></div>
        <div><dt>Declared payout recipient</dt><dd>{recipient}</dd></div>
        <div><dt>Recipient status</dt><dd style={{ fontFamily: 'var(--sans)' }}><Registration account={recipient} /></dd></div>
      </dl>
      <p className="hint">Fixed once the trial opens. {account !== recipient && account === c.launch.creator ? 'You are the creator; draws go to the recipient above, and only the recipient can sign them.' : ''}</p>
      {c.launch.mode === 'instant' ? (
        <>
          <h3>1. Allocation vesting</h3>
          <VestPanel launchId={c.launch.launch_id} symbol={c.launch.symbol} seedLabel="Your USDC seed is locked in the pool and cannot be withdrawn." />
        </>
      ) : (
        <>
          <h3>1. Proceeds stream</h3>
          <StreamPanel c={c} canAct={canAct} />
        </>
      )}
      <h3>2. Trading-fee share</h3>
      <FeesPanel c={c} canAct={canAct} />
    </article>
  );
}

export function CreatorView() {
  const { sessions } = useWallet();
  const [lookup, setLookup] = useState('');
  const [applied, setApplied] = useState('');
  const account = applied || sessions.near?.address || '';
  const s = useApi(account ? () => api.creator(account) : null, `creator-${account}`, 20000);

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Creator Desk</p>
        <h1>What a creator can and cannot take.</h1>
        <p className="lede">Two separate income lines: a proceeds stream after PASS at a capped rate, and a share of trading fees once a pool exists. Nothing is earned before PASS, and nothing here is a promise of income.</p>
      </header>
      <form className="card" onSubmit={(e) => { e.preventDefault(); setApplied(lookup.trim()); }} aria-label="Choose an account">
        <label htmlFor="who" style={{ marginTop: 0 }}>Creator or payout account (read only)</label>
        <div className="row"><input id="who" style={{ flex: '1 1 260px', width: 'auto' }} value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="alice.testnet" autoComplete="off" autoCapitalize="none" spellCheck={false} />
          <button type="submit" disabled={!lookup.trim()}>Show desk</button>{applied && <button type="button" className="btn-quiet" onClick={() => { setApplied(''); setLookup(''); }}>Use my wallet</button>}</div>
        <p className="hint">{account ? `Showing ${account}.` : 'Connect a NEAR wallet from any action button, or type an account to read its desk.'}</p>
      </form>
      <div className="callout info"><p><b>Pending payout change:</b> none. The submission build has no method that changes a payout recipient; the later flow (propose, 48 hour wait, new address accepts) is not built.</p></div>

      {!account && <EmptyState title="No account selected">Type a creator account above to see its launches, stream and fee claims.</EmptyState>}
      {s.status === 'loading' && <LoadingBlock label="Loading the desk" />}
      {s.status === 'error' && <ErrorState error={s.error} what="the creator desk" onRetry={s.reload} />}
      {s.status === 'ok' && (
        <>
          <div className="row between" style={{ margin: '8px 0 16px' }}>
            <Freshness source={s.data.source} asOf={s.data.as_of} />
            <a className="btn" href={creatorCsvUrl(account)} download>Export claims as CSV</a>
          </div>
          {s.data.launches.length === 0
            ? <EmptyState title="This account has no launches or payouts" action={<Link className="btn" href="/create">Open the Studio</Link>}>The indexer found nothing where it is the creator or the payout recipient.</EmptyState>
            : (
              <>
                <section className="card" aria-labelledby="tot-h">
                  <h2 id="tot-h" style={{ marginTop: 0 }}>Totals</h2>
                  <dl className="kv">
                    <div><dt>Stream drawn</dt><dd>{fmtUsdc(s.data.totals.stream_drawn ?? '0')}</dd></div>
                    <div><dt>Trading-fee slice accrued</dt><dd>{fmtUsdc(s.data.totals.market_fees_creator_slice ?? '0')}</dd></div>
                    <div><dt>Fee claims paid</dt><dd>{fmtUsdc(s.data.totals.claimed ?? '0')}</dd></div>
                  </dl>
                </section>
                {s.data.launches.map((c) => <LaunchDesk key={c.launch.launch_id} c={c} account={account} />)}
                <section aria-labelledby="claims-h">
                  <h2 id="claims-h">Claims and draws</h2>
                  {s.data.claims.length === 0 ? <EmptyState title="No draws or claims yet" /> : (
                    <div className="tbl-wrap"><table>
                      <thead><tr><th>When</th><th>Launch</th><th>Kind</th><th className="n">Amount</th><th>Receipt id</th></tr></thead>
                      <tbody>{s.data.claims.map((cl, i) => (
                        <tr key={`${cl.receipt_id}-${i}`}><td>{fmtDate(cl.time)}</td><td>#{cl.launch_id}</td><td>{titleCase(cl.kind)}</td><td className="n">{fmtUsdc(cl.amount)}</td>
                          <td className="mono" style={{ overflowWrap: 'anywhere' }}>{cl.receipt_id} <SourceBadge source={cl.source} /></td></tr>
                      ))}</tbody>
                    </table></div>
                  )}
                </section>
              </>
            )}
        </>
      )}
    </>
  );
}
