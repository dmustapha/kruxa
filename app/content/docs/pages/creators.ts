import type { Page } from '../../types';
import { h2, note, ol, p, table, ul } from '../../blocks';
import { FACTS as F, effectiveSplit, slicePctOfVolume } from '../facts';

const eff = effectiveSplit(F.split);

export const creators: Page = {
  slug: 'creators',
  title: 'For creators',
  group: 'Use',
  summary: 'How to open a trial, what you choose, what the contract fixes, and what you cannot do.',
  blocks: [
    note('warn', 'On mainnet only the owner can open a trial until the capped beta opens. Before then the Studio shows "beta closed" and testnet is open to anyone. No independent audit has covered the contracts.', 'Who can launch'),
    h2('How to launch'),
    ol(
      'Open the Studio and pick a preset: supply, bucket split, caps, windows, stream length and fee terms.',
      'The Studio calls the `preview_charter` view. It needs no wallet and shows the result or the rule codes. A hostile preset (for example a creator allocation above 20%, or a zero window) is refused with `R_ALLOC` or `R_WINDOW` before you sign anything.',
      'Connect a NEAR wallet and sign `create_trial` with the required deposit. The `required_deposit` view shows the number first.',
      'The contract validates the whole Charter, snapshots it, stores its hash and creates the launch token. If token creation fails, the deposit returns and no trial opens. If the callback never arrives, anyone can call `finalize_creation` after 10 minutes.',
      'Share the trial page. Buyers commit during the window.',
    ),
    p('The deposit is a refundable creator bond sized for position storage: `max_holders x 0.0033 NEAR + 0.013`. It is released after the trial dissolves or settles.'),
    h2('What you choose, and the bounds'),
    table(
      ['Choice', 'Bound'],
      ['Token supply (whole tokens)', `${F.supplyWhole.min.toLocaleString('en-US')} to ${F.supplyWhole.max.toLocaleString('en-US')}`],
      ['Sale share of supply', `${F.saleBps.min / 100}% to ${F.saleBps.max / 100}%`],
      ['Liquidity share of supply', `${F.lpBps.min / 100}% to ${F.lpBps.max / 100}%`],
      ['Your allocation', `up to ${F.creatorBpsMax / 100}%`],
      ['Backer bonus', `up to ${F.backerBpsMax / 100}%, and your allocation plus the bonus up to ${F.creatorPlusBackerBpsMax / 100}%`],
      ['Buckets together', 'must sum to exactly 100% (`R_BUCKETS`)'],
      ['Hard cap', `$${F.hardCapMinUsdc} to $${F.hardCapMaxUsdc.toLocaleString('en-US')}`],
      ['Soft cap', `at least $${F.softCapFloorUsdc} and at least ${F.softCapFloorPct}% of the hard cap`],
      ['Minimum backers', `${F.funders.min} to ${F.funders.max}`],
      ['Commit window', `${F.commitHours.min} hours to 30 days`],
      ['Walk tail', `${F.tailHours.min} to ${F.tailHours.max} hours`],
      ['Stream length', `${F.streamDays.min} to ${F.streamDays.max} days`],
      ['Symbol', '2 to 12 characters, A-Z and 0-9. KRUXA, USDC, USDT, NEAR, WNEAR, SOL, ETH, BTC and DAI are reserved (`R_SYMBOL`)'],
    ),
    p('The soft cap must be reachable: minimum backers times the minimum buy cannot exceed it (`R_PASSABLE`). You can have one active trial at a time (`R_ACTIVE_TRIAL`).'),
    h2('Payout recipient'),
    ul(
      'Your payouts go to the **payout recipient**. It defaults to the account that signs `create_trial`. You may choose a separate NEAR account at creation.',
      '**It is fixed once the trial opens.** The submission build has no method that changes it. It sits in the Charter and in the Charter hash that buyers saw before committing.',
      'The recipient must be registered on native USDC. The Studio warns before you sign. An unregistered recipient does not lose money, because payouts are pull-based and failed payouts are re-credited.',
      'Payouts are to NEAR accounts first. A Solana-only creator is out of scope for now.',
    ),
    h2('What you earn, and when'),
    table(
      ['Source', 'Starts', 'Limit'],
      ['Proceeds stream', 'at PASS', '`STREAM_CAP`: never more than elapsed time times rate. Zero before PASS.'],
      ['Trade-fee creator slice', 'after the market opens', `${F.split.creator}% of the trade fee; about ${slicePctOfVolume(F.tradeFeePctStandard, F.split.creator).toFixed(2)}% of volume at a ${F.tradeFeePctStandard.toFixed(2)}% fee. ${F.feeVest.pct}% of each day's slice vests linearly over ${F.feeVest.days} days, the rest is claimable at once.`],
      ['Creator token allocation', 'PASS plus a cliff of at least 14 days', 'the claim path is not built in Wave 1'],
    ),
    p(`Nothing is earned before PASS. On FAIL you earn nothing and the platform earns nothing. The launch fee is ${F.launchFeePct}% of the accepted raise (minimum $${F.launchFeeMinUsdc}); at a $1,000 raise that is $15.`),
    note('warn', `The contract caps the **declared** creator slice at ${F.creatorTakeMaxPctOfVolume.toFixed(2)}% of trading volume. That is not the same as "the creator can take at most 1%". Wallets a creator controls could also capture parts of the holder and referral slices once those exist. The hard bound on everything a creator-controlled set of wallets could extract is 80% of the fee, which is 1.60% of volume at the ${F.tradeFeePctMax.toFixed(2)}% maximum fee. The holder and referral payouts are not built in this release, so today the working creator share is the ${F.split.creator}% slice.`, 'The creator maximum, stated precisely'),
    p('None of this is a promise of income. No income, volume or return is claimed anywhere in these docs.'),
    h2('What you cannot do'),
    ul(
      'Draw anything before PASS, or more than the stream cap after it. Over-cap draws revert with `STREAM_CAP`.',
      'Loosen any term after the trial opens. Terms can only tighten or lengthen (`R_RATCHET`).',
      'Buy your own launch from the creator account or the payout recipient (`R_SELF_BUY`).',
      'Change the payout recipient after the trial opens.',
      'Block a Walk, change a stored verdict, or move a buyer\'s funds.',
      'Create an exemption list, allowlist or fee waiver. None exists.',
      'Open a second trial while one is active, or use a reserved symbol.',
      'Cancel and keep anything: a creator cancel makes the verdict FAIL with reason `CANCELLED`, and everyone is refunded.',
    ),
    note('info', `Sybil wallets are not defended against. The contract counts accounts, not people, so a creator could fund their own launch from other wallets. What it costs them: the ${F.launchFeePct}% launch fee, locked liquidity, and the fact that every backer can still Walk. No sybil-resistance claim is made.`, 'A limit we state'),
    h2('The market side for creators'),
    p(`Working split in this release, of a ${F.tradeFeePctStandard.toFixed(2)}% fee: creator ${eff.creator}%, platform ${eff.platform}%, liquidity ${eff.lp}% (the holders and referral slices go to liquidity). Details: [Fees](/docs/fees).`),
  ],
};
