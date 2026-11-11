import type { Page } from '../../types';
import { h2, note, p, table, ul } from '../../blocks';
import { FACTS as F, effectiveSplit, slicePctOfVolume } from '../facts';

const I = F.instant;

const s = F.split;
const eff = effectiveSplit(s);
const pct = (slice: number) => `${slicePctOfVolume(F.tradeFeePctStandard, slice).toFixed(2)}%`;

export const fees: Page = {
  slug: 'fees',
  title: 'Fees',
  group: 'Use',
  summary: 'Every fee Kruxa charges or passes through, who pays it, and where the trade fee goes.',
  blocks: [
    h2('All the fees at a glance'),
    table(
      ['Fee', 'Who pays', 'Amount', 'When'],
      ['Launch fee', 'taken from the raise', `${F.launchFeePct}% of the accepted raise, minimum $${F.launchFeeMinUsdc}, maximum $${F.launchFeeMaxUsdc.toLocaleString('en-US')}. At a $1,000 raise: $15.`, 'only on PASS. Zero on FAIL.'],
      ['Instant launch fee', 'the creator, taken from the pool seed', `a flat $${I.launchFeeMainnetUsdc} USDC on mainnet, zero on testnet. The pool opens with the seed minus this fee.`, 'when the seed is accepted. Run on testnet, not on mainnet.'],
      ['Instant creation deposit', 'the creator', `about ${I.depositNear} NEAR, covering the factory token, storage and the market's setup. Excess is sent back; parts of it are kept if the launch fails.`, 'at `create_instant`'],
      ['Relay fee', 'a Solana-origin buyer who asks someone else to submit the call', `flat, quoted before you sign, at most the lower of $${F.relayFeeCeilingUsdc.toFixed(2)} or ${F.relayFeeCeilingPct}% of the amount`, 'at commit. Never refunded. NEAR buyers pay none.'],
      ['Intents withdrawal fee', 'a buyer moving funds to a Solana address', `fixed ${F.intentsSolanaWithdrawFeeUsdc.toFixed(2)} USDC per withdrawal. The platform never pays it.`, 'when you withdraw to Solana. 0.15% at a $20 amount.'],
      ['Trade fee', 'every buyer and seller on the Kruxa pool', `typically ${F.tradeFeePctStandard.toFixed(2)}%, set in the Charter between ${F.tradeFeePctMin}% and ${F.tradeFeePctMax.toFixed(2)}%`, 'on each trade after the market opens'],
      ['Opening fee', 'early traders', `starts above the base fee and decays to it. The Charter sets the start (up to ${F.openingFeeStartMaxPct}%) and the decay time (up to ${F.openingDecayMaxMinutes} minutes). The extra goes to liquidity.`, 'right after the pool opens'],
      ['Network gas', 'whoever submits the call', 'the platform does not pay a buyer\'s gas', 'every call'],
      ['Token registration', 'the claimant', `at least ${F.tokenClaimNearAttach} NEAR attached to a token claim; ${F.solanaClaimRentSol} SOL refundable claim deposit on Solana`, 'at claim'],
    ),
    h2('Where the trade fee goes'),
    p(`The fee on each trade is cut into five slices. The ruled default split is ${s.creator} / ${s.platform} / ${s.holders} / ${s.lp} / ${s.referral}, in percent of the fee. The split is validated when the trial is created, written into the Charter, and cannot be loosened later.`),
    table(
      ['Slice', 'Share of the fee', `Of volume at a ${F.tradeFeePctStandard.toFixed(2)}% fee`, 'In this release'],
      ['Creator', `${s.creator}%`, pct(s.creator), 'paid to the payout recipient'],
      ['Platform', `${s.platform}%`, pct(s.platform), 'paid to the Kruxa treasury'],
      ['Holders', `${s.holders}%`, pct(s.holders), '**redirected to liquidity**'],
      ['Locked liquidity', `${s.lp}%`, pct(s.lp), 'stays in the pool'],
      ['Referral', `${s.referral}%`, pct(s.referral), '**redirected to liquidity**'],
    ),
    note('warn', `In this release the holders and referral slices are redirected to liquidity, because the Hold Vault and referral payouts are not built. The working split is therefore creator ${eff.creator}%, platform ${eff.platform}%, liquidity ${eff.lp}% of the fee. At a ${F.tradeFeePctStandard.toFixed(2)}% fee that is ${pct(eff.creator)}, ${pct(eff.platform)} and ${pct(eff.lp)} of each trade's volume. The market reports these redirected amounts as separate counters, so you can see them.`, 'Honest note on the split'),
    h2('The limits the contract enforces'),
    ul(
      `Total fee: ${F.tradeFeePctMin}% to ${F.tradeFeePctMax.toFixed(2)}%.`,
      'Creator share: at most 60% of the fee.',
      'Platform share: at least 15% (and fixed at 15% in this build).',
      'Holders: 10% to 30%. Liquidity: at least 5%. Holders plus liquidity: at least 20%. Referral: at most 20%.',
      `Declared creator take: at most ${F.creatorTakeMaxPctOfVolume.toFixed(2)}% of volume, checked as an exact integer product.`,
      `Creator vesting: at least 25% of the creator slice vests, over 30 to 365 days. Default ${F.feeVest.pct}% over ${F.feeVest.days} days.`,
    ),
    note('warn', `The contract caps the **declared** creator slice at ${F.creatorTakeMaxPctOfVolume.toFixed(2)}% of volume. It does not cap everything creator-controlled wallets might extract. That bound is 80% of the fee, or 1.60% of volume at the ${F.tradeFeePctMax.toFixed(2)}% maximum fee. Wash trading still costs the creator at least 20% of the fees paid.`, 'The creator maximum, with its qualifier'),
    h2('How a trade is charged'),
    ul(
      'Fees are paid in USDC: on the input for a buy, on the gross output for a sell.',
      `Minimum trade: $${F.marketMinTradeUsdc}.`,
      'Every trade needs a minimum-out amount greater than zero, so a price move past your limit refuses the trade instead of filling it.',
      'The fee is rounded up on the way in and paid amounts round down, with leftover dust going to liquidity.',
    ),
    h2('Instant launches use the same trade fee'),
    p(`An Instant launch uses the same fee terms, the same split and the same minimum-out rule as a Trial launch. Its default opening fee starts at ${I.openingFeeStartBps / 100}% and falls to the base fee over ${I.openingDecayMinutes} minutes, and the surcharge goes to liquidity. In this release the holders and referral slices are redirected to liquidity here too. The creator also holds a token allocation that unlocks over time, which is not a fee. See [For creators](/docs/creators).`),
    h2('What no fee does'),
    ul(
      'A Walk returns your principal to your own account. A relay fee you already paid is not returned.',
      'There are no exemption lists, fee waivers or creator-controlled discounts.',
      'Nothing here is a statement about earnings. Trading volume, creator income and platform income are unknown.',
    ),
  ],
};
