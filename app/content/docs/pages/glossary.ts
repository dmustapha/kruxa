import type { Page } from '../../types';
import { table } from '../../blocks';
import { FACTS as F } from '../facts';

export const glossary: Page = {
  slug: 'glossary',
  title: 'Glossary',
  group: 'Reference',
  summary: 'The words Kruxa uses, in plain language first.',
  blocks: [
    table(
      ['Term', 'Plain meaning'],
      ['Trial', 'A launch that is refundable until its deadline.'],
      ['Charter', 'The fixed terms of one launch, hashed so buyers can see what they agreed to. See [The Charter](/docs/charter).'],
      ['Commit', 'Putting USDC into a trial.'],
      ['Walk', 'Taking your whole position back before the Walk deadline. All or nothing.'],
      ['Walk tail', `The period after commits close and before the verdict when you can still Walk (${F.tailHours.min} to ${F.tailHours.max} hours).`],
      ['Soft cap', 'The minimum total commits for a PASS.'],
      ['Hard cap', 'The most the launch will take in. Extra commits are refunded pro rata.'],
      ['Minimum backers', 'The minimum number of accounts that must still be committed for a PASS.'],
      ['Verdict', 'PASS or FAIL, computed from total active commits, active backers and the cancelled flag.'],
      ['Settle', 'The call that records the verdict. Anyone can make it after the Walk deadline.'],
      ['Position', 'Your stored commit, including where a refund must be paid.'],
      ['Stream cap', 'The limit on how much of the proceeds the creator can draw so far. Exceeding it reverts with `STREAM_CAP`.'],
      ['Payout recipient', 'The account that receives the creator\'s stream and fee claims. Fixed once the trial opens.'],
      ['Genesis', 'The one-time creation of the Solana mint after a PASS, with mint and freeze authority set to none.'],
      ['Null authority', 'A mint authority set to none, so nobody can create more supply or freeze accounts.'],
      ['Market-lite', 'Kruxa\'s own capped constant-product pool on NEAR for trading after PASS.'],
      ['Constant-product pool', 'A pool where the product of the two reserves stays the same, so bigger trades move the price more.'],
      ['Price impact', 'How much your own trade moves the price in a pool.'],
      ['Minimum-out', 'The least you will accept from a trade. Below it, the trade is refused.'],
      ['Intents', 'NEAR Intents, the cross-chain layer used to hold USDC for Solana-only buyers.'],
      ['Intents account', 'Your account in `intents.near`, named by your public key. It is yours; refunds there are between you and Intents.'],
      ['Relay fee', 'A flat fee a Solana-origin buyer pays so someone else submits the signed call. Not refunded.'],
      ['Fixture', 'Sample data shown for layout, never a real launch. Labelled as such.'],
      ['Sybil', 'One person acting as many accounts. Not defended against.'],
      ['Labels', 'SANDBOX, DRY-RUN, DRY QUOTE, RECORDED, TESTNET, DEVNET and MAINNET mark what kind of state you are looking at.'],
      ['Rule code', 'A short name such as `R_WINDOW` that a refusal returns, so you can see which rule you broke.'],
    ),
  ],
};
