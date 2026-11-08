import type { Page } from '../../types';
import { h2, p } from '../../blocks';
import { FACTS as F } from '../facts';

const I = F.instant;
const q = (question: string, answer: string) => [h2(question), p(answer)];

export const faq: Page = {
  slug: 'faq',
  title: 'FAQ',
  group: 'Reference',
  summary: 'Short answers, each pointing to the page that has the detail.',
  blocks: [
    ...q('Can I lose money?', 'Yes. The principal you commit can be returned if you Walk or if the trial fails, minus any fee already paid. After a PASS you hold a token that can lose all of its value, and nothing here supports its price. Kruxa has had no independent audit. On an Instant launch there is no refund at all and the token can lose all of its value. See [Security and trust](/docs/security).'),
    ...q('What is an Instant launch?', `A second launch mode, higher risk. The token is created now and trades as soon as the creator\'s own USDC seed ($${I.seedUsdc.min} to $${I.seedUsdc.max}) opens the pool. There is no trial, no verdict, no Walk and no refund. It is NEAR only, and it is being built: the interface is a draft and nothing is deployed. See [How it works](/docs/how-it-works).`),
    ...q('Can I get a refund on an Instant launch?', 'No. Nothing in the contracts returns a buyer\'s money. You can sell back into the pool at its price.'),
    ...q('Can an Instant creator pull the liquidity?', 'No contract method exists that withdraws it. The seed goes into the market pool for good. The market and the launcher can still be upgraded by the project owner\'s phase 0 key, which is disclosed, and the price can still fall to near zero.'),
    ...q('Is an Instant launch safer than other launchpads?', 'Do not compare. We make no such claim. Read what the contracts enforce and what they do not on [Security and trust](/docs/security).'),
    ...q('Can an Instant token creator sell their tokens?', `Yes, what has unlocked. The allocation is at most ${I.allocBpsMax / 100}% of supply, locked for a cliff of ${I.cliffDays.min} to ${I.cliffDays.max} days and then unlocked linearly over ${I.vestDays.min} to ${I.vestDays.max} days. The creator can sell it and can move it to other wallets once claimed.`),
    ...q('Is there an Instant launch on Solana?', 'No. Instant launches are NEAR only for now. There is no Solana mint for them.'),
    ...q('Can my exit be blocked?', `A pause blocks new launches and new buys but not exits. A guardian freeze can block exits too, and it expires by itself after ${F.frozenExpiryDays} days. That limit is in the committed attack gallery as bounded, not prevented. See [Security and trust](/docs/security).`),
    ...q('What is a trial?', 'A launch with a deadline and a verdict. Buyers commit, can leave until the Walk deadline, and the token\'s Solana mint is created only if the verdict is PASS. See [How it works](/docs/how-it-works).'),
    ...q('What is the Walk?', 'Your right to take your whole position back before the Walk deadline. Nobody can block it or redirect the money. See [For buyers](/docs/buyers).'),
    ...q('Do I get 100% of my money back?', `Your principal, yes, to your own account. Not 100% of everything: a relay fee already paid is not returned, and moving funds to a Solana address costs a fixed ${F.intentsSolanaWithdrawFeeUsdc.toFixed(2)} USDC.`),
    ...q('Who decides PASS or FAIL?', 'A rule, not a person. PASS needs total active commits at least the soft cap, active backers at least the minimum, and no creator cancel. Anyone can recompute it. See [Verify a launch](/docs/verify).'),
    ...q('Can the creator take the money and leave?', 'In a Trial launch, not at once. The creator draws nothing before PASS, and after PASS the contract allows only the streamed amount. A larger draw reverts with `STREAM_CAP`. The creator also cannot change the payout recipient after the trial opens.'),
    ...q('What is the most a creator can earn from trading?', `The contract caps the declared creator slice at ${F.creatorTakeMaxPctOfVolume.toFixed(2)}% of volume. Creator-controlled wallets could capture other slices once those exist, bounded by 80% of the fee. See [Fees](/docs/fees). No income is promised.`),
    ...q('Is there a sybil defense?', 'No. The backer count counts accounts. A creator could fund their own launch from other wallets, which costs them the launch fee and locked liquidity.'),
    ...q('Why is the token created before the verdict?', 'The NEAR-side token is created when the trial opens. Only the Solana mint waits for PASS.'),
    ...q('Can I use Kruxa with only a Solana wallet?', 'Through NEAR Intents, with Phantom. It is labelled an unproven path. Two legs ran live on 2026-11-08, but the receipts are not committed and Phantom signing has not been checked byte for byte. See [For buyers](/docs/buyers).'),
    ...q('Which wallets work?', 'NEAR wallets through the near-connect chooser. For Solana, Phantom is the only one in scope. Solflare and Backpack signing is unverified. Real-wallet tests are listed as pending.'),
    ...q('What are the limits on how much can be raised?', `$${F.perLaunchCapUsdc.toLocaleString('en-US')} per launch and $${F.globalCapUsdc.toLocaleString('en-US')} across all launches. Raising those caps is queued for ${F.capRaiseTimelockDays} days and is public.`),
    ...q('Is the contract upgradeable?', 'In phase 0, yes: the owner holds a full-access key. Treat the contract as changeable until the verifier prints zero full-access keys. See [Security and trust](/docs/security).'),
    ...q('Who holds the reserve?', 'For the demo, one person holds all three keys of the Squads reserve vault. Third-party creators open only after two named independent signers join.'),
    ...q('Can Kruxa remove my token?', 'Kruxa can hide a token from its own feeds and refuse to route it, and is meant to log each such action publicly. It cannot stop the token trading elsewhere, and it cannot touch your Walk or refund.'),
    ...q('Can I trade a Kruxa token on another chain through Kruxa?', 'No. A launched token has no Intents quote, so cross-chain trading does not work.'),
    ...q('Why did my Intents leg take so long?', `Most took about 90 seconds. One swap stalled for about ${F.intentsStallMinutes} minutes before completing. Funds in motion are not lost, but you cannot act on them until they land.`),
    ...q('Is there an API?', 'A read-only API, an OpenAPI file and agent-readable notes exist in the repository. An agent can read and verify. It cannot sign or spend through Kruxa.'),
    ...q('Where is the legal text?', 'The terms, privacy and risk pages are drafts with placeholders. They are not legal advice. See [Terms (draft)](/legal/terms).'),
  ],
};
