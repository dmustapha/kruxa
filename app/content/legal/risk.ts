import type { Page } from '../types';
import { h2, note, p, table, ul } from '../blocks';
import { FACTS as F } from '../docs/facts';

export const risk: Page = {
  slug: 'risk',
  title: 'Risk disclosure (draft)',
  group: 'Reference',
  summary: 'What can go wrong, said plainly. Read it before you sign anything.',
  blocks: [
    note('draft', 'This is a draft, not legal advice, and it has not been reviewed by counsel. The risks below are true as of the project documents dated 2026-11-08, but the list is not complete.', 'Draft status'),
    note('warn', 'You can lose all of the money you commit and all of the value of any token you hold. Mainnet is real money.', 'The main risk'),
    h2('Contract and platform risks'),
    ul(
      '**No independent audit.** No outside reviewer has examined the core contract, the market contract or the genesis relayer. Bugs may exist.',
      `**Caps limit damage.** Launches are capped at $${F.perLaunchCapUsdc.toLocaleString('en-US')} each and $${F.globalCapUsdc.toLocaleString('en-US')} overall to limit the damage of a bug. A capped loss is still a loss.`,
      '**The code can change.** In phase 0 the project owner holds a full-access key that can replace the core contract.',
      '**Single-party reserve in the demo.** One person controls all keys of the demo reserve vault.',
      '**The market is new code.** The pool contract is unreviewed, its reserves are capped, and liquidity is permanent: nobody can withdraw it.',
      '**Mainnet acceptance is untested.** The contract has run in a sandbox. Behaviour on the real network can differ.',
      '**Sybil wallets.** The backer count counts accounts, not people. A creator can fund their own launch from other wallets.',
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
      ['How the trial and verdict work', '[How it works](/docs/how-it-works)'],
      ['Who holds which key', '[Security and trust](/docs/security)'],
      ['Every fee', '[Fees](/docs/fees)'],
      ['Checking a verdict yourself', '[Verify a launch](/docs/verify)'],
    ),
    p('Contact: [PROJECT/ENTITY NAME], [CONTACT EMAIL]. Restricted regions: [RESTRICTED REGIONS].'),
  ],
};
