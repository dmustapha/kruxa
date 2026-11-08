import { Badge } from '@/components/ui/Badges';
import { ModeBadge } from '@/components/ui/PhaseBadge';

/** Non-dismissible notice for every instant launch (CHANGE-ORDER-7 4.3). Exported for the token page. */
export function InstantNotice() {
  return (
    <div className="callout" role="note">
      <p><ModeBadge mode="instant" /></p>
      <p><b>Launched instantly: no trial.</b> Nobody committed refundable money first, there was no verdict and no Walk. Buyers cannot get a refund. Higher risk.</p>
    </div>
  );
}

export const RISK_POINTS: string[] = [
  'There is no trial, no verdict, no Walk and no refund for anyone who buys.',
  'Your seed goes into the pool for good. No method can withdraw it, and it can be lost in price moves.',
  'The price can fall to near zero. Nothing supports it.',
  'You may sell unlocked allocation, and buyers will see that on chain. Nothing stops anyone from buying with wallets they have not declared.',
  'The contracts are unreviewed and there is no independent audit. The token code is the factory\'s global contract, whose publisher key can change it.',
];

export function RiskPanel() {
  return (
    <section className="callout bad" aria-labelledby="risk-h">
      <h3 id="risk-h" style={{ margin: '0 0 6px', fontSize: '1rem' }}>Higher risk: read this before you launch</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{RISK_POINTS.map((r) => <li key={r} style={{ color: 'var(--fg)' }}>{r}</li>)}</ul>
    </section>
  );
}

export const ACK_TEXT = 'I understand buyers of an instant launch get no trial and no refund, and my seed cannot be withdrawn.';

export function StatusPill({ state }: { state: 'done' | 'next' | 'wait' | 'dead' }) {
  return state === 'done' ? <Badge tone="pass">Done</Badge> : state === 'next' ? <Badge tone="warn">Next</Badge> : state === 'dead' ? <Badge tone="fail">Ended</Badge> : <Badge tone="muted">Waiting</Badge>;
}
