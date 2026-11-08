'use client';
// "Contract facts": the instant-launch replacement for the trial Verify tab. There is no verdict to recompute. Each row is a fact from
// the logs or the contracts with its basis, and `unknown` where nothing is logged.
import { contractFacts, vestSchedule } from '@/lib/market/instant';
import type { MarketFacts } from '@/lib/market/facts';
import type { InstantBundle, Section } from '@/lib/market/hooks';
import type { TokenPageData } from '@/lib/market/types';
import { CopyButton } from './CopyButton';
import { Async, Panel } from './shared';

const WORD = { pass: { g: '✓', w: 'Pass', c: 'mkt-up' }, info: { g: 'i', w: 'Info', c: 'mkt-muted' }, unknown: { g: '?', w: 'Unknown', c: 'mkt-muted' } } as const;

export function ContractFacts({ page, facts, instant, nowSec }: { page: TokenPageData; facts: MarketFacts; instant: Section<InstantBundle>; nowSec: number }) {
  const cmd = `./scripts/verify.sh instant ${page.launch.launch_id}`;
  return (
    <Panel title="Contract facts" id="mkt-facts-h">
      <p className="mkt-note" style={{ marginTop: 0 }}>An instant launch has no trial and no verdict, so there is nothing to recompute here. These are the facts the contracts and logs carry, each with where it comes from.</p>
      <Async section={instant} lines={4}>
        {(b) => {
          const sched = vestSchedule(b.info, b.vesting, nowSec);
          const rows = contractFacts({
            totalSupply: facts.totalSupply ?? b.info?.total_supply ?? null, info: b.info, sched, safety: page.safety,
            feeTotalBps: facts.terms?.total_fee_bps ?? null, payout: page.creator?.payout_recipient ?? page.launch.payout_recipient, token: facts.token, market: facts.market,
          });
          return (
            <ul className="mkt-list">
              {rows.map((r) => {
                const w = WORD[r.status];
                return (
                  <li key={r.id}>
                    <span className={`mkt-chip mkt-chip-${r.status === 'pass' ? 'ok' : 'unknown'}`} style={{ minWidth: 92, justifyContent: 'center' }}><span aria-hidden="true">{w.g}</span>{w.w}</span>
                    <span><strong>{r.label}</strong>: <span className="mkt-mono">{r.value}</span></span>
                    <span className="mkt-detail">{r.detail ?? ''} <span className="mkt-mono">[{r.basis}]</span></span>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </Async>
      <h3 className="mkt-h3">Check it outside this page</h3>
      <div className="mkt-cmd"><code>{cmd}</code><CopyButton text={cmd} label="the verify command" /></div>
      <p className="mkt-note">Checks supply, buckets, custody, pool mode and open time, and the launcher ABI. Exit code 0 means every check matched.</p>
    </Panel>
  );
}
