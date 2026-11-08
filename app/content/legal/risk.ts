import type { Page } from '../types';
import { h2, note, p, table, ul } from '../blocks';
import { FACTS as F } from '../docs/facts';

const I = F.instant;

export const risk: Page = {
  slug: 'risk',
  title: 'Risk disclosure (draft)',
  group: 'Reference',
  summary: 'What can go wrong, said plainly. Read it before you sign anything.',
  blocks: [
    note('draft', 'This is a draft, not legal advice, and it has not been reviewed by counsel. The risks below are true as of the project documents dated 2026-11-08, but the list is not complete.', 'Draft status'),
    note('warn', 'You can lose all of the money you commit and all of the value of any token you hold. Mainnet is real money.', 'The main risk'),
    h2('Instant launches carry higher risk'),
    note('unproven', 'The Instant launcher is being built. Its interface is a draft and it is not deployed. This section describes the risks of the planned mode so you can read them before it exists.', 'Being built'),
    ul(
      '**No trial, no verdict, no Walk and no refund.** Nobody committed refundable money first. If you buy an Instant token, nothing returns your money. You can only sell back into the pool at its price.',
      '**The price can fall to near zero, quickly.** Pools can be thin and the creator seeds them with as little as $' + I.seedUsdc.min + '.',
      `**The creator can sell.** Up to ${I.allocBpsMax / 100}% of supply is allocated to the creator and unlocks after a cliff of ${I.cliffDays.min} to ${I.cliffDays.max} days and then over ${I.vestDays.min} to ${I.vestDays.max} days. What has unlocked can be sold, and claimed tokens can be moved to other wallets.`,
      '**Insiders can buy at the open.** A self-buy block covers only the creator account and the payout recipient. Other wallets, including ones the creator controls, are not stopped. Bots can also buy before you.',
      '**Volume can be fake.** Wash trading can make a token look active. It costs the fees paid, and it is not prevented.',
      '**Serial launches.** One account can launch once per 24 hours, but a new account can launch again.',
      '**It is not backed by a verdict.** A TRIAL-VERIFIED badge never appears on an Instant token. The badge INSTANT (NO TRIAL) is there to tell you so.',
      '**No independent audit.** Like the rest of Kruxa, the launcher has had no independent audit. Mainnet is real money.',
    ),
    h2('Contract and platform risks'),
    ul(
      '**No independent audit.** No outside reviewer has examined the core contract, the market contract or the genesis relayer. Bugs may exist.',
      `**Caps limit damage.** Launches are capped at $${F.perLaunchCapUsdc.toLocaleString('en-US')} each and $${F.globalCapUsdc.toLocaleString('en-US')} overall to limit the damage of a bug. A capped loss is still a loss.`,
      '**The code can change.** In phase 0 the project owner holds a full-access key that can replace the core contract.',
      '**Single-party reserve in the demo.** One person controls all keys of the demo reserve vault.',
      '**The market is new code.** The pool contract is unreviewed, its reserves are capped, and liquidity is permanent: nobody can withdraw it.',
      '**Mainnet acceptance is untested.** The contract has run in a sandbox. Behaviour on the real network can differ.',
      '**Sybil wallets reach PASS.** The backer count counts accounts, not people. In our own attack gallery, one actor splitting capital over 12 wallets reached the soft cap and the minimum backers, because the contract cannot tell the wallets are one actor. This is a disclosed limit, not a defense. The total accepted equaled the capital the actor put at risk.',
      '**A guardian freeze can block exits.** A freeze can stop exits, including a Walk, for up to 7 days. It ends by itself and falls back to a pause, and the owner can lift it sooner. A pause alone does not block exits. This is a disclosed limit from the attack gallery, bounded and not prevented.',
    ),
    h2('Token and market risks'),
    ul(
      'A PASS verdict means a rule was met. It does not mean the token has value, will keep value or can be sold.',
      'Tokens can lose all of their value, quickly.',
      'Pools are thin. A trade can move the price a lot (price impact). Always read the minimum-out.',
      'The NEAR-side token exists from the start of a trial, before the verdict.',
      'The supply is fixed at launch. The launch-token factory contract\'s owner can update the token\'s code.',
      'Solana holders after PASS have fixed-supply protection and claims, not a refund right.',
      'A token cannot be traded across chains through Kruxa.',
      'Fee slices for holders and referrals are redirected to liquidity in this release.',
    ),
    h2('Walk, refund and cross-chain risks'),
    ul(
      'Walk ends at the Walk deadline. After it you cannot leave.',
      'A relay fee is not refunded.',
      `Moving funds from Intents to a Solana address costs a fixed ${F.intentsSolanaWithdrawFeeUsdc.toFixed(2)} USDC.`,
      `Intents has a delay tail. One swap took about ${F.intentsStallMinutes} minutes to complete. Normal legs took about 90 seconds.`,
      'Money held in NEAR Intents is exposed to the Verifier\'s DAO-held force-withdraw and lock functions.',
      'The Solana-only path is unproven for Phantom signing. Two legs ran live on 2026-11-08 and their receipts are not yet committed. See [For buyers](/docs/buyers).',
    ),
    h2('Wallet and website risks'),
    ul(
      'The wallet connector loads its wallet list and wallet code from remote hosts. If those hosts are compromised, so is what you see.',
      'The website, the indexer and the RPC can be wrong, stale or down. Run the verifier to check a verdict yourself.',
      'The app has not been tested against live wallets on all devices. Wallet tests are pending.',
      'Phishing copies of this site can exist. Check the address before you connect.',
    ),
    h2('Where each risk is explained'),
    table(
      ['Topic', 'Page'],
      ['Trial launches versus Instant launches', '[How it works](/docs/how-it-works)'],
      ['Who holds which key', '[Security and trust](/docs/security)'],
      ['Every fee', '[Fees](/docs/fees)'],
      ['Checking a verdict yourself', '[Verify a launch](/docs/verify)'],
    ),
    p('Contact: Kruxa project, damilolamustaphaa@gmail.com. Restricted regions: none at this time. You are responsible for checking that use is lawful where you are.'),
  ],
};
