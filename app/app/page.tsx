import Link from 'next/link';

export default function Landing() {
  return (
    <>
      <h1>A token launch that is a refundable trial first.</h1>
      <p>Buyers commit USDC. Until the trial ends every buyer can Walk: the principal is returned to the account it came from, and the platform takes no fee. A fixed rule then decides PASS or FAIL. Only on PASS do sale tokens exist for claiming and does the creator start drawing proceeds, capped at elapsed time times a fixed rate.</p>
      <div className="card">
        <b>Try it with no wallet and no funds</b>
        <p>Open the <Link href="/demo">verification page</Link>. It recomputes the verdict and the settlement arithmetic in your browser from the same rules the contract runs and prints MATCH or MISMATCH. The Tamper box flips one unit and must print MISMATCH.</p>
      </div>
      <h2>What runs where</h2>
      <ul>
        <li>NEAR contract: charter, hold ledger, Walk, verdict, refunds, claims. USDC only. Testnet and a labelled demo profile.</li>
        <li>NEAR Intents: Solana buyers pay through a signed transfer that notifies the contract (mt_on_transfer); refunds return to their Intents account.</li>
        <li>Capped ladder: $1,000 per launch, $3,000 global. Raising a cap is timelocked 7 days.</li>
      </ul>
      <h2>Honest limits</h2>
      <p>Single-party upgrade key while on testnet. The launch token comes from a factory whose code its owner can change; the README says so. No independent review yet. Nothing here is on mainnet.</p>
    </>
  );
}
