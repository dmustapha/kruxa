import type { Page } from '../types';
import { h2, note, p, ul } from '../blocks';

export const terms: Page = {
  slug: 'terms',
  title: 'Terms of use (draft)',
  group: 'Reference',
  summary: 'Draft terms for the Kruxa web interface. Placeholders must be filled and the text reviewed by a lawyer.',
  blocks: [
    note('draft', 'Nothing on this page is in force until the owner fills the placeholders, a qualified lawyer reviews it, and it is published as final. Testnet rehearsal and capped mainnet use only.', 'Draft status'),
    h2('1. Who we are'),
    p('This interface is operated by [PROJECT/ENTITY NAME] ("we", "us"). Contact: [CONTACT EMAIL]. No legal entity, address or contact has been confirmed for this draft.'),
    h2('2. What Kruxa is'),
    p('Kruxa is a software interface to public smart contracts on NEAR and, after a passed trial, to a token on Solana. The contracts, not the website, decide verdicts, refunds and payouts. We do not hold your funds on the website. Funds sit in the contracts, in NEAR Intents, or in your own wallet.'),
    p('We make no custody claim beyond what the contracts do. The contracts are controlled in part by keys described on the [Security and trust](/docs/security) page, including an upgrade key held by the project owner.'),
    h2('3. No advice'),
    p('Nothing here is investment, legal, tax or financial advice. A trial passing its verdict says that a rule was met. It says nothing about the value of the token.'),
    h2('4. Your responsibilities'),
    ul(
      'You control your wallet and keys. We cannot recover them or reverse a transaction.',
      'You check the launch label (SANDBOX, TESTNET, DEVNET or MAINNET), the Charter, the fees and the amounts before you sign.',
      'You are responsible for taxes and for the laws that apply to you.',
      'You read the [Risk disclosure (draft)](/legal/risk).',
    ),
    h2('5. Eligibility and restricted regions'),
    p('You may not use the interface if you are in, or a resident of, [RESTRICTED REGIONS], or if using it would be unlawful for you. The list of restricted regions has not been decided and must be completed by the owner on legal advice.'),
    h2('6. Prohibited use'),
    ul(
      'Using the interface to defraud, deceive or manipulate other users, including wash trading and false identity.',
      'Launching a token that infringes someone\'s rights, impersonates another project or uses a reserved symbol.',
      'Attacking, scraping at abusive volume or overloading the interface or its data sources.',
      'Evading a restriction applied under these terms.',
    ),
    h2('7. What we can and cannot do to a token'),
    p('We can hide a token from Kruxa\'s own feeds and refuse to route it through Kruxa. We cannot stop a token trading elsewhere. We cannot change a stored verdict, block a Walk, redirect a refund or move your funds. Moderation actions are intended to be recorded in a public log with the token, reason, actor, time and an appeal path. The appeal process has not been defined: [CONTACT EMAIL].'),
    h2('8. No warranty and limits of liability'),
    p('The interface and contracts are provided as they are, with no independent audit. [GOVERNING LAW AND LIABILITY WORDING: to be written by counsel]. We do not promise availability. The website can be down while the contracts keep working, and you can recompute a verdict without our site.'),
    h2('9. Changes'),
    p('We may change these terms. The date of the latest change will be shown here once the page is final. The date is not set in this draft.'),
    h2('10. Contact'),
    p('[PROJECT/ENTITY NAME], [CONTACT EMAIL].'),
  ],
};
