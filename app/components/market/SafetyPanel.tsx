import { shortAccount } from '@/lib/market/format';
import type { SafetyIndicator, SafetyStatus, TokenPageData } from '@/lib/market/types';
import { Panel, SourceBadge } from './shared';

const EXPECTED: { id: string; label: string }[] = [
  { id: 'verdict_passed', label: 'Trial verdict PASS' },
  { id: 'lp_in_pool', label: 'Liquidity seeded in the pool' },
  { id: 'mint_authority_null', label: 'Mint authority is null' },
  { id: 'freeze_authority_null', label: 'Freeze authority is null' },
  { id: 'payout_recipient_declared', label: 'Payout recipient declared' },
  { id: 'market_not_paused', label: 'Market not paused' },
  { id: 'creator_fee_within_bound', label: 'Creator fee within bound' },
  { id: 'verdict_inputs_hash_present', label: 'Verdict inputs hash recorded' },
];
const ICON: Record<SafetyStatus, { glyph: string; word: string; cls: string }> = {
  pass: { glyph: '✓', word: 'Pass', cls: 'mkt-chip-ok' },
  warn: { glyph: '!', word: 'Warning', cls: 'mkt-chip-warn' },
  fail: { glyph: '✕', word: 'Fail', cls: 'mkt-chip-bad' },
  unknown: { glyph: '?', word: 'Unknown', cls: 'mkt-chip-unknown' },
};

/** Every expected fact gets a row. A fact the API did not log is shown as unknown, never as a pass. */
export function mergeIndicators(api: SafetyIndicator[]): SafetyIndicator[] {
  const byId = new Map(api.map((i) => [i.id, i]));
  const rows = EXPECTED.map(({ id, label }) => {
    const hit = byId.get(id);
    if (!hit) return { id, label, status: 'unknown' as const, basis: 'not_indexed' as const, detail: 'The indexer did not report this fact.' };
    return hit.basis === 'not_indexed' && hit.status !== 'unknown' ? { ...hit, status: 'unknown' as const } : hit;
  });
  return [...rows, ...api.filter((i) => !EXPECTED.some((e) => e.id === i.id))];
}

export function SafetyPanel({ page }: { page: TokenPageData }) {
  const rows = mergeIndicators(page.safety);
  const { creator, launch } = page;
  const account = creator?.account ?? launch.creator;
  const payout = creator?.payout_recipient ?? launch.payout_recipient;
  return (
    <Panel title="Safety indicators" id="mkt-safety-h" right={<SourceBadge source={page.source} asOf={page.as_of} />}>
      <ul className="mkt-list">
        {rows.map((r) => {
          const ic = ICON[r.status];
          return (
            <li key={r.id}>
              <span className={`mkt-chip ${ic.cls}`} style={{ minWidth: 92, justifyContent: 'center' }}><span aria-hidden="true">{ic.glyph}</span>{ic.word}</span>
              <span>{r.label}</span>
              <span className="mkt-detail">{r.detail ?? ''}{r.detail ? ' ' : ''}<span className="mkt-mono">[{r.basis === 'not_indexed' ? 'not logged' : r.basis}]</span></span>
            </li>
          );
        })}
      </ul>
      <p className="mkt-note">Pool liquidity: the market contract has no LP withdrawal method in this release. That is a property of unreviewed code, not an audit, and it says nothing about a pool on another venue. Custody, admin keys and limits are listed in the <a href="/charter">Charter</a>.</p>
      <h3 style={{ fontSize: 13, margin: '16px 0 6px', color: 'var(--muted)', fontWeight: 500 }}>Creator record</h3>
      <dl className="mkt-kv">
        <dt>Creator</dt><dd title={account}>{shortAccount(account, 16, 4)}</dd>
        <dt>Payout recipient</dt><dd title={payout}>{shortAccount(payout, 16, 4)}{payout !== account && <span className="mkt-warn"> (differs)</span>}</dd>
        <dt>Creator fees claimed</dt><dd>{creator?.creator_claimed !== undefined ? `$${(Number(creator.creator_claimed) / 1e6).toFixed(2)}` : 'unknown'}</dd>
        <dt>Other launches</dt><dd>unknown</dd>
      </dl>
    </Panel>
  );
}
