'use client';
// Buy and sell against the NEAR pool. Every trade is an ft_transfer_call carrying a v1 message with a mandatory min_out
// (MARKET-ABI.md). The quote is computed in the browser with a bigint port of crates/kruxa-market, so it matches the contract.
// Signing goes through the WalletAdapter and nowhere else; mainnet is locked by the wallet layer's network guard.
import { useEffect, useId, useMemo, useState } from 'react';
import { useWallet } from '@/components/wallet/index';
import { MARKET_CONFIG } from '@/lib/market/config';
import { viewCall } from '@/lib/market/chain';
import type { MarketFacts } from '@/lib/market/facts';
import { fmtUnits, fmtBps, fmtDuration } from '@/lib/market/format';
import type { MarketConfigView } from '@/lib/market/chain';
import { instantCapCheck, REFUSAL_TEXT, selfBuyBlock } from '@/lib/market/rules';
import { openingWindow } from '@/lib/market/math';
import { computeQuote, parseReserves, parseSlippagePct, type Side } from '@/lib/market/quote';
import { buildTradeTx, describeSignError } from '@/lib/market/tx';
import { TRADE_ACTION } from '@/lib/market/wallet-bridge';
import { useSettings } from '@/lib/useSettings';
import type { TokenPageData } from '@/lib/market/types';
import { Panel } from './shared';
import { QuoteSummary, SlippageControl } from './TradeParts';

interface Props {
  page: TokenPageData;
  facts: MarketFacts;
  reserves: { q: string | null | undefined; t: string | null | undefined };
  nowSec: number;
  onSubmitted(): void;
  initialSide?: Side;
  /** Instant pools: the market's self-buy block and instant sub-cap apply (MARKET-ABI 1.1.0). `declared` is [creator, payout recipient]. */
  instant?: { declared: string[]; config: MarketConfigView | null };
}
type Phase = { s: 'idle' } | { s: 'signing' } | { s: 'sent'; txHash?: string } | { s: 'error'; message: string };


export function TradePanel({ page, facts, reserves, nowSec, onSubmitted, initialSide, instant }: Props) {
  const { guard, sessions, adapters, openChooser } = useWallet();
  const [side, setSide] = useState<Side>(initialSide ?? 'buy');
  const [amount, setAmount] = useState('');
  const [prefs] = useSettings();
  const BUY_QUICK = prefs.buyPresets.map(String);
  const [slip, setSlip] = useState('1');
  const [slipTouched, setSlipTouched] = useState(false);
  useEffect(() => { if (!slipTouched) setSlip(prefs.slippagePct); }, [prefs.slippagePct, slipTouched]);
  const [phase, setPhase] = useState<Phase>({ s: 'idle' });
  const [balance, setBalance] = useState<string | null>(null);
  const amountId = useId();
  const near = sessions.near;
  const tokenContract = side === 'buy' ? MARKET_CONFIG.usdcAccount : facts.token;
  const pool = page.pool;

  useEffect(() => {
    setBalance(null);
    if (!near || !tokenContract) return;
    let live = true;
    void viewCall<string>(tokenContract, 'ft_balance_of', { account_id: near.address }).then((b) => { if (live && typeof b === 'string') setBalance(b); });
    return () => { live = false; };
  }, [near, tokenContract, phase.s === 'sent']);

  const slipBps = parseSlippagePct(slip);
  const view = useMemo(() => computeQuote({ side, amountText: amount, reserves: parseReserves(reserves.q, reserves.t), terms: facts.terms, openedAtSec: facts.openedAtSec, nowSec, slippageBps: slipBps ?? 100 }),
    [side, amount, reserves.q, reserves.t, facts.terms, facts.openedAtSec, nowSec, slipBps]);
  const win = facts.terms && facts.openedAtSec ? openingWindow(facts.terms, facts.openedAtSec, nowSec) : null;
  const openingNote = win ? `${fmtBps(Math.round(win.appliedBps))} now, base ${fmtBps(win.baseBps)}` : null;

  const selfBlock = selfBuyBlock(!!instant, side, instant?.declared ?? [], near?.address ?? null);
  const poolR = parseReserves(reserves.q, reserves.t);
  const reserveDelta = view.status === 'ok' && poolR ? view.quote.after.q - poolR.q : null;
  const cap = instant && side === 'buy' ? instantCapCheck(instant.config, reserveDelta) : null;
  const blockedReason: string | null =
    page.source === 'fixture' ? 'Fixture data: nothing here is on a chain, so trading is off.'
    : !pool.open ? 'Trading opens when the pool opens. No pool has been indexed for this launch.'
    : selfBlock ? selfBlock
    : cap?.status === 'refused' ? cap.message
    : side === 'buy' && pool.paused ? 'Buys are paused on this market. Sells, claims and withdrawals are never paused.'
    : side === 'sell' && !facts.token ? 'The launch token account is not reported by the indexer and could not be read from chain, so a sell cannot be built.'
    : !guard.signingEnabled ? (guard.lockReason ?? 'Signing is locked on this network.')
    : null;
  const canSubmit = view.status === 'ok' && slipBps !== null && !blockedReason && phase.s !== 'signing';

  async function submit() {
    if (view.status !== 'ok' || !tokenContract || slipBps === null) return;
    if (!near) { openChooser({ action: TRADE_ACTION, chains: ['near'] }); return; }
    setPhase({ s: 'signing' });
    try {
      const tx = buildTradeTx({ side, launchId: page.launch.launch_id, amountIn: view.amountIn, minOut: view.minOut, receiver: near.address, market: facts.market, tokenContract });
      const res = await adapters.near.signAndSendTransaction(tx);
      setPhase({ s: 'sent', txHash: res.txHash });
      setAmount('');
      onSubmitted();
    } catch (e) { setPhase({ s: 'error', message: describeSignError(e) }); }
  }

  const unit = side === 'buy' ? 'USDC' : page.launch.symbol;
  const buttonText = phase.s === 'signing' ? 'Waiting for wallet...' : !near ? (sessions.solana ? 'Connect a NEAR wallet to trade' : 'Connect wallet to trade') : `${side === 'buy' ? 'Buy' : 'Sell'} ${page.launch.symbol}`;
  const bal = balance !== null ? fmtUnits(balance, 6, side === 'buy' ? 2 : 0) : null;

  return (
    <Panel title="Trade" id="mkt-trade-h" right={<span className="mkt-chip mkt-chip-chain">NEAR pool only</span>}>
      <div role="tablist" aria-label="Order side" className="mkt-tabs">
        {(['buy', 'sell'] as const).map((s) => (
          <button key={s} type="button" role="tab" id={`mkt-tab-${s}`} data-side={s} aria-selected={side === s} aria-controls="mkt-order" tabIndex={side === s ? 0 : -1}
            onClick={() => { setSide(s); setAmount(''); setPhase({ s: 'idle' }); }}
            onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { setSide(s === 'buy' ? 'sell' : 'buy'); setAmount(''); document.getElementById(`mkt-tab-${s === 'buy' ? 'sell' : 'buy'}`)?.focus(); } }}>
            {s === 'buy' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>
      {instant && win && (
        <p className="mkt-alert" data-tone="warn" role="timer" aria-live="off"><strong>Opening fee: {fmtBps(Math.round(win.appliedBps))} now</strong>Falling to the {fmtBps(win.baseBps)} base in <span className="mkt-mono">{fmtDuration(win.secondsLeft)}</span>. The extra goes to liquidity.</p>
      )}
      {instant && (
        <ul className="mkt-rules" aria-label="Instant pool rules">
          {cap && cap.status !== 'refused' && side === 'buy' && <li>{cap.message}</li>}
          <li>Creator and payout recipient accounts cannot buy on an instant pool (R_SELF_BUY). Other wallets are not blocked.</li>
        </ul>
      )}
      <form id="mkt-order" role="tabpanel" aria-labelledby={`mkt-tab-${side}`} onSubmit={(e) => { e.preventDefault(); if (canSubmit || (!near && view.status === 'ok')) void submit(); }} noValidate>
        <div className="mkt-field">
          <div className="mkt-label"><label htmlFor={amountId}>{side === 'buy' ? 'You pay' : 'You sell'}</label>{bal && <span>Balance {bal} {unit}</span>}</div>
          <div className="mkt-inputwrap">
            <input id={amountId} inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value); if (phase.s !== 'signing') setPhase({ s: 'idle' }); }}
              aria-invalid={view.status === 'invalid' || undefined} aria-describedby="mkt-quote-note" />
            <span className="mkt-unit">{unit}</span>
          </div>
          <div className="mkt-quick" role="group" aria-label="Quick amounts">
            {side === 'buy' ? BUY_QUICK.map((v) => <button key={v} type="button" aria-pressed={amount === v} onClick={() => setAmount(v)}>${v}</button>)
              : balance !== null && [25, 50, 100].map((p) => <button key={p} type="button" onClick={() => setAmount(fmtUnits((BigInt(balance) * BigInt(p)) / 100n, 6, 6).replace(/,/g, ''))}>{p}%</button>)}
          </div>
        </div>
        <SlippageControl value={slip} onChange={(v) => { setSlipTouched(true); setSlip(v); }} />
        <div id="mkt-quote-note"><QuoteSummary side={side} view={view} openingNote={openingNote} /></div>
        {view.status === 'ok' && view.highImpact && <div className="mkt-alert" data-tone="warn" role="status"><strong>High price impact</strong>This trade moves the pool price by {(view.quote.priceImpactBps / 100).toFixed(1)}%. Consider a smaller amount.</div>}
        {blockedReason && <div className="mkt-alert" data-tone={guard.signingEnabled ? 'warn' : 'bad'} role="status">{blockedReason}</div>}
        {!near && sessions.solana && <div className="mkt-alert" data-tone="warn" role="status">Trading on the NEAR pool needs a NEAR wallet. A launch token cannot be traded across chains here.</div>}
        {phase.s === 'error' && <div className="mkt-alert" data-tone="bad" role="alert"><strong>Not sent</strong>{phase.message}</div>}
        {phase.s === 'sent' && (
          <div className="mkt-alert" data-tone="ok" role="status">
            <strong>Submitted to your wallet&apos;s network</strong>
            {phase.txHash ? <>Transaction <a href={`${MARKET_CONFIG.explorerTx}${phase.txHash}`} target="_blank" rel="noopener noreferrer" className="mkt-mono">{phase.txHash.slice(0, 10)}…</a>. </> : null}
            The market can still refuse a swap; the token contract then refunds you. Check the result on the explorer.{instant && <span className="mkt-note" style={{ display: 'block' }}>{REFUSAL_TEXT.R_SELF_BUY} {REFUSAL_TEXT.R_MARKET_CAP}</span>}
          </div>
        )}
        <button type="submit" className="mkt-submit" data-side={side} disabled={near ? !canSubmit : (view.status !== 'ok' || !!blockedReason)} aria-busy={phase.s === 'signing' || undefined}>{buttonText}</button>
        <p className="mkt-note">You always get at least the minimum above or nothing is swapped. Fee is taken in USDC. Unreviewed testnet contract, not investment advice.</p>
      </form>
    </Panel>
  );
}
