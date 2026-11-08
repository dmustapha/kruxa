import Link from 'next/link';
import { HeadlinePlaceholder } from '@/components/features/HeadlinePlaceholder';
import { HeroActionsAndCard } from '@/components/features/LandingLive';

export default function Landing() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-h">
        <p className="eyebrow">Refundable-trial launches for NEAR and Solana</p>
        <HeadlinePlaceholder id="hero-h" />
        <p className="lede">
          Kruxa is a launch platform where every token launch is a refundable trial. Every buyer can walk away before a deterministic verdict. The token exists on Solana only if the trial passes. After a pass, the creator can only draw proceeds at a capped rate.
        </p>
        <HeroActionsAndCard />
      </section>

      <section aria-labelledby="how-h">
        <h2 id="how-h">What a stranger can check</h2>
        <div className="pillars">
          <div><b>Walk before the verdict</b><p>Until the deadline, a buyer can Walk and get principal back to the NEAR or Intents account it came from. The platform takes no fee on a Walk; a relay fee, if paid, is not returned.</p></div>
          <div><b>The verdict is a rule</b><p>Total committed, backers, soft cap, minimum backers. Anyone can recompute PASS or FAIL from public reads. <Link href="/launches">See the margin on every launch.</Link></p></div>
          <div><b>The creator draw is capped</b><p>After PASS the contract refuses any draw above elapsed time times a fixed rate, with the code <code>STREAM_CAP</code>. <Link href="/creator">Press Withdraw all and watch it revert.</Link></p></div>
        </div>
      </section>

      <section aria-labelledby="built-h">
        <h2 id="built-h">What is built today, and what is not</h2>
        <div className="grid grid-2">
          <div className="card">
            <h3>Exercised on NEAR testnet and Solana devnet</h3>
            <p>The trial contract (commit, Walk, settle, refunds, claims, capped stream), the pure verdict logic, the indexer, and the Meteora devnet venue spike. See <Link href="/proof">Proof</Link> for each row with its label.</p>
          </div>
          <div className="card">
            <h3>Not proven, or not claimed</h3>
            <p>No independent audit. Phantom signing of the Intents payload (OV3) is unproven. No wallet in this app has signed on testnet yet (PD-1). Nothing here is on mainnet. <Link href="/charter">All disclosures</Link>.</p>
          </div>
        </div>
      </section>
    </>
  );
}
