import type { Page } from '../types';
import { h2, note, p, table, ul } from '../blocks';

export const privacy: Page = {
  slug: 'privacy',
  title: 'Privacy notice (draft)',
  group: 'Reference',
  summary: 'Draft privacy notice: what the app stores, what hosting may log, which third parties are contacted.',
  blocks: [
    note('draft', 'The hosting provider, its logging defaults and the retention period have not been confirmed. Items marked as unconfirmed must be checked before this notice is published.', 'Draft status'),
    h2('Who is responsible'),
    p('[PROJECT/ENTITY NAME], [CONTACT EMAIL]. No entity is confirmed in this draft.'),
    h2('What the app stores on your device'),
    ul(
      'Preferences only, in your browser\'s local storage: slippage, preset amounts, RPC overrides, time display and similar settings. You can clear them in Settings.',
      'There are no accounts, no passwords and no email sign-up.',
      'If your browser blocks storage, the app still works without remembering settings.',
    ),
    h2('What the server may log'),
    p('Web hosts normally log IP addresses and request details, and the API may do the same. This is the default for most hosting and is **unconfirmed** for this project. Hosting provider: [HOSTING PROVIDER]. Retention period: [LOG RETENTION PERIOD]. We do not run analytics or advertising trackers in the code reviewed for this draft. Confirm before publishing.'),
    h2('Third parties your browser or the app contacts'),
    table(
      ['Party', 'Why', 'What they can see'],
      ['Wallet manifest and wallet code hosts (raw.githubusercontent.com and jsdelivr, through near-connect)', 'The wallet chooser loads its list and wallet code, in sandboxed frames, when you open it', 'Your IP address and that you requested the files. The wallet code runs in your browser.'],
      ['NEAR and Solana RPC providers', 'Reading chain state and sending the transactions you sign', 'Your IP address and the addresses and transactions you query or send'],
      ['1Click API (NEAR Intents)', 'Quotes for Solana-origin deposits', 'The quote request, including the addresses you supply'],
      ['Your wallet', 'Signing', 'Whatever you choose to sign. Read each prompt.'],
    ),
    h2('Blockchain data is public and permanent'),
    p('Your commits, Walks, claims, token balances and addresses are written to public blockchains. We cannot edit or delete them, and anyone can link them to your address.'),
    h2('Your choices'),
    ul(
      'Run the verifier or your own RPC to avoid relying on our site.',
      'Set your own RPC endpoints in Settings.',
      'Use a fresh wallet if you do not want activity linked to an existing one.',
    ),
    h2('Requests and contact'),
    p('For access or deletion questions about anything we hold, contact [CONTACT EMAIL]. Rights under specific laws (for example in your region) have not been assessed. [RESTRICTED REGIONS] and applicable privacy law are for counsel to complete.'),
  ],
};
