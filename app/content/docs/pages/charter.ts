import type { Page } from '../../types';
import { h2, note, p, table, ul } from '../../blocks';
import { FACTS as F } from '../facts';

export const charter: Page = {
  slug: 'charter',
  title: 'The Charter and disclosures',
  group: 'Trust',
  summary: 'What a Charter fixes for every launch, and the full list of things Kruxa tells you up front.',
  blocks: [
    h2('What a Charter is'),
    p('The Charter is the written terms of one launch: supply and buckets, caps, windows, stream length, fee terms and the payout recipient. The contract validates it when the trial opens, stores it once and stores its hash. Buyers see the same hash before they commit.'),
    ul(
      'After the trial opens, terms can only tighten or lengthen. A change that loosens a term returns `R_RATCHET`.',
      'The rules in force at creation are copied into the Charter, so a later change to the platform constants cannot loosen an existing launch.',
      'The fee split, the vesting and the opening-fee terms are committed in the Charter. The payout recipient is part of the hash.',
      'There is no exemption list, allowlist or creator-controlled fee waiver. If one is ever added, it must be public, stored in the Charter, fixed at open and capped.',
    ),
    h2('Disclosures'),
    p('These are shown on every launch and repeated here. Each traces to a project document.'),
    table(
      ['Disclosure', 'Plain meaning'],
      ['No independent audit', 'No outside reviewer has examined the contracts, including the market contract.'],
      ['Single-party reserve in the demo', 'One person holds all three keys of the demo reserve vault.'],
      ['Upgrade key', 'In phase 0 the owner holds a full-access key that can redeploy the core contract. No immutability claim is made.'],
      ['Factory token is publisher-updatable', 'The launch token\'s code comes from a global contract whose owner can update it.'],
      ['Intents force powers', 'The Intents Verifier\'s DAO can force-withdraw or lock money held in `intents.near`.'],
      ['Relay fee is not refunded', 'A relay fee paid at commit is not returned on a Walk.'],
      ['NEAR-side token exists from the start', 'The launch token on NEAR exists when the trial opens. Only the Solana mint waits for PASS.'],
      ['Caps', `$${F.perLaunchCapUsdc.toLocaleString('en-US')} per launch and $${F.globalCapUsdc.toLocaleString('en-US')} across all launches, in USDC.`],
      ['Solana holders after PASS', 'Fixed-supply protection and claims, not a refund right.'],
      ['Intents solver latency tail', `One swap took about ${F.intentsStallMinutes} minutes before completing. Normal legs took about 90 seconds.`],
      ['Wallet code from remote hosts', 'The wallet connector loads its manifest and wallet code from remote hosts.'],
      ['Market contract is new and unreviewed', 'Pool reserves are capped. Liquidity is permanent. Holders and referral slices are redirected to liquidity in this release.'],
      ['Sybil wallets', 'Not defended against. The backer count counts accounts, not people.'],
      ['Moderation', 'Kruxa can hide a token from its feeds and refuse to route it. It cannot stop trading elsewhere.'],
    ),
    note('info', 'The app has a `/charter` page planned as the disclosures page. This docs page is the explainer it links to. If the two ever differ, the contract and the repository documents win.'),
  ],
};
