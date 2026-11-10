// Every number the docs quote, in one place. app/content/docs/facts.test.ts checks these against
// crates/kruxa-logic/src/rules.rs (Rules::ladder and FeeTerms::standard), the instant launcher constants and the committed
// attack gallery file, so the prose cannot drift from the code or the evidence.
import galleryJson from './attack-gallery.summary.json';

export const STATUS_DATE = '2026-11-08';

// The attack gallery numbers are IMPORTED from attack-gallery.summary.json, a copy of the committed evidence file written by
// `npm run sync` (scripts/sync-evidence.mjs). They are never typed, and content/evidence-sync.test.ts fails if the copy drifts.
// Only the fields this app reads are typed. The `attacks` rows are what the Security page lists as bounded.
export interface GalleryAttack { id: string; title: string; result: 'REFUSED' | 'NO_EFFECT' | 'BOUNDED'; expected_rule_code?: string | null }
export interface GalleryFile {
  network: string; generated_at: string; git_head: string;
  counts: { total: number; refused: number; no_effect: number; bounded: number; failed: number; succeeded_unexpectedly: number; attack_transactions: number; by_group: Record<string, number> };
  attacks: GalleryAttack[];
  not_done: { id: string; what: string; why: string }[];
}
export const GALLERY = galleryJson as unknown as GalleryFile;
export const BOUNDED_ATTACKS: GalleryAttack[] = GALLERY.attacks.filter((a) => a.result === 'BOUNDED');

export const FACTS = {
  perLaunchCapUsdc: 1_000,
  globalCapUsdc: 3_000,
  hardCapMinUsdc: 500,
  hardCapMaxUsdc: 1_000,
  softCapFloorUsdc: 350,
  softCapFloorPct: 20,
  minBuyUsdc: 20,
  funders: { min: 10, max: 500 },
  walletCapPct: { min: 0.5, max: 5 },
  commitHours: { min: 24, max: 720 },
  tailHours: { min: 1, max: 48 },
  studioDefault: { commitHours: 72, tailHours: 6, streamDays: 30 },
  openDelayDays: 7,
  streamDays: { min: 30, max: 365 },
  supplyWhole: { min: 10_000_000, max: 1_000_000_000_000 },
  saleBps: { min: 5_000, max: 8_000 },
  lpBps: { min: 1_500, max: 4_000 },
  creatorBpsMax: 2_000,
  backerBpsMax: 1_000,
  creatorPlusBackerBpsMax: 2_500,
  oversubCeilingX: 2,
  backerVestDays: 30,
  launchFeePct: 1.5,
  launchFeeMinUsdc: 10,
  launchFeeMaxUsdc: 2_500,
  relayFeeCeilingUsdc: 0.5,
  relayFeeCeilingPct: 5,
  intentsSolanaWithdrawFeeUsdc: 0.03,
  capRaiseTimelockDays: 7,
  frozenExpiryDays: 7,
  tradeFeePctStandard: 1,
  tradeFeePctMax: 2,
  tradeFeePctMin: 0.3,
  creatorTakeMaxPctOfVolume: 1,
  split: { creator: 50, platform: 15, holders: 15, lp: 10, referral: 10 },
  feeVest: { pct: 50, days: 90 },
  openingFeeStartMaxPct: 10,
  openingDecayMaxMinutes: 120,
  marketMinTradeUsdc: 1,
  marketPoolReserveCapUsdc: 5_000,
  marketGlobalReserveCapUsdc: 15_000,
  tokenClaimNearAttach: 0.00125,
  solanaClaimRentSol: 0.004,
  intentsLegSeconds: { low: 90, high: 97 },
  intentsStallMinutes: 35,
  instant: {
    supplyWhole: 1_000_000_000,
    tokenDecimals: 6,
    allocBpsMax: 1_000,
    allocBpsDefault: 500,
    cliffDays: { min: 7, max: 30, default: 7 },
    vestDays: { min: 30, max: 365, default: 90 },
    seedUsdc: { min: 100, max: 1_000, default: 250 },
    seedAggregateCapUsdc: 3_000,
    launchFeeMainnetUsdc: 10,
    launchFeeTestnetUsdc: 0,
    depositNear: 0.13125,
    rateLimitHours: 24,
    abandonHours: 24,
    abortHours: 72,
    openingFeeStartBps: 500,
    openingDecayMinutes: 60,
  },
  gallery: {
    file: 'evidence/attack-gallery/attack-gallery.json',
    network: GALLERY.network,
    generatedAt: GALLERY.generated_at,
    total: GALLERY.counts.total,
    refused: GALLERY.counts.refused,
    noEffect: GALLERY.counts.no_effect,
    bounded: GALLERY.counts.bounded,
    failed: GALLERY.counts.failed,
    succeededUnexpectedly: GALLERY.counts.succeeded_unexpectedly,
    attackTransactions: GALLERY.counts.attack_transactions,
    byGroup: GALLERY.counts.by_group,
    gitHead: GALLERY.git_head,
  },
  test1Tx: '3KLVemdjr387BsqJiuuV9By9VXzeri6GRFwy3HMRT6ko',
} as const;

/** Effective split in this release: the holders and referral slices are redirected to liquidity. */
export function effectiveSplit(s: { creator: number; platform: number; holders: number; lp: number; referral: number }) {
  return { creator: s.creator, platform: s.platform, lp: s.lp + s.holders + s.referral };
}

/** Percent of trade volume for one slice at a given total fee percent. Rounded to 4 places to avoid float noise. */
export function slicePctOfVolume(totalFeePct: number, slicePct: number): number {
  return Math.round(totalFeePct * slicePct * 100) / 10_000;
}
