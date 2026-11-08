import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Charter and disclosures' };

const ITEMS: { h: string; p: string }[] = [
  { h: 'Custody', p: 'During a trial the contract holds buyers\' USDC. A Walk returns principal to the account it came from. A relay fee, if paid, is not returned. Moving a refund from Intents to a Solana wallet costs a fixed Intents withdrawal fee, shown before you sign.' },
  { h: 'No independent audit', p: 'Nothing here has been independently reviewed. The market contract is unreviewed and capped.' },
  { h: 'Upgrade key', p: 'A single-party phase-0 upgrade key exists while on testnet. Whether any contract is immutable is claimed only when the verifier prints the KEYS and CODE lines for that account.' },
  { h: 'Reserve', p: 'The demo reserve vault is held by one person. Independent co-signers are not named yet.' },
  { h: 'Token factory', p: 'The launch token comes from a factory whose publisher key can change token code. The NEAR-side token exists from the start of the trial; only the Solana mint is gated by PASS.' },
  { h: 'Intents', p: 'Intents has force functions held by its DAO. The Solana-only buyer path is unproven with a real Phantom (OV3), and Intents legs have a seen-once latency tail of about 35 minutes.' },
  { h: 'Caps', p: '$1,000 per launch and $3,000 global. Raising a cap is timelocked 7 days.' },
  { h: 'Creator maximum', p: 'The contract caps the declared creator slice of trading fees at 1.00% of volume. What creator-controlled wallets can extract is bounded by 80% of the fee, which is 1.60% of volume at the 2.00% maximum fee.' },
  { h: 'Market control', p: 'Kruxa can hide a token from Kruxa feeds and refuse to route it. It cannot stop a token trading elsewhere.' },
  { h: 'Solana holders', p: 'Tokens delivered on Solana after PASS carry fixed-supply protection and claims, not a refund right.' },
  { h: 'No claims about returns', p: 'Nothing here is a revenue, yield, return, fairness or sybil-resistance claim, and nothing is investment advice.' },
];

export default function CharterPage() {
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Disclosures</p>
        <h1>The limits, stated plainly.</h1>
        <p className="lede">This page is linked from the strip on every page. It lists what Kruxa holds, what it can change, and what is not proven.</p>
      </header>
      <div className="stack">
        {ITEMS.map((i) => <section key={i.h} className="card" style={{ margin: 0 }}><h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>{i.h}</h2><p>{i.p}</p></section>)}
      </div>
    </>
  );
}
