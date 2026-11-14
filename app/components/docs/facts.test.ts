import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACTS, effectiveSplit, slicePctOfVolume } from '@/content/docs/facts';

// The prose quotes FACTS. These tests tie FACTS to the Rust rules so a rule change fails the docs build.
const rust = readFileSync(resolve(__dirname, '../../../crates/kruxa-logic/src/rules.rs'), 'utf8');
const ladder = rust.slice(rust.indexOf('pub fn ladder()'), rust.indexOf('pub fn demo_clock()'));
const standard = rust.slice(rust.indexOf('pub fn standard()'), rust.indexOf('pub struct TrialParams'));

function num(src: string, field: string): number {
  const m = new RegExp(`${field}:\\s*([0-9_]+)(?:\\s*\\*\\s*USDC)?`).exec(src);
  if (!m) throw new Error(`field not found: ${field}`);
  return Number(m[1].replace(/_/g, ''));
}

describe('FACTS match Rules::ladder()', () => {
  it('caps, windows and counts', () => {
    expect(num(ladder, 'min_hard_cap')).toBe(FACTS.hardCapMinUsdc);
    expect(num(ladder, 'max_hard_cap')).toBe(FACTS.hardCapMaxUsdc);
    expect(num(ladder, 'min_soft_abs')).toBe(FACTS.softCapFloorUsdc);
    expect(num(ladder, 'min_soft_pct_bps') / 100).toBe(FACTS.softCapFloorPct);
    expect(num(ladder, 'min_buy_abs')).toBe(FACTS.minBuyUsdc);
    expect(num(ladder, 'funders_min')).toBe(FACTS.funders.min);
    expect(num(ladder, 'funders_max')).toBe(FACTS.funders.max);
    expect(num(ladder, 'wallet_bps_min') / 100).toBe(FACTS.walletCapPct.min);
    expect(num(ladder, 'wallet_bps_max') / 100).toBe(FACTS.walletCapPct.max);
    expect(num(ladder, 'min_commit_secs') / 3600).toBe(FACTS.commitHours.min);
    expect(num(ladder, 'max_commit_secs') / 3600).toBe(FACTS.commitHours.max);
    expect(num(ladder, 'min_tail_secs') / 3600).toBe(FACTS.tailHours.min);
    expect(num(ladder, 'max_tail_secs') / 3600).toBe(FACTS.tailHours.max);
    expect(num(ladder, 'max_open_delay_secs') / 86_400).toBe(FACTS.openDelayDays);
    expect(num(ladder, 'max_oversub_bps') / 10_000).toBe(FACTS.oversubCeilingX);
  });
  it('supply, buckets and streams', () => {
    expect(num(ladder, 'min_supply_whole')).toBe(FACTS.supplyWhole.min);
    expect(num(ladder, 'max_supply_whole')).toBe(FACTS.supplyWhole.max);
    expect(num(ladder, 'min_sale_bps')).toBe(FACTS.saleBps.min);
    expect(num(ladder, 'max_sale_bps')).toBe(FACTS.saleBps.max);
    expect(num(ladder, 'min_lp_bps')).toBe(FACTS.lpBps.min);
    expect(num(ladder, 'max_lp_bps')).toBe(FACTS.lpBps.max);
    expect(num(ladder, 'max_creator_bps')).toBe(FACTS.creatorBpsMax);
    expect(num(ladder, 'max_backer_bps')).toBe(FACTS.backerBpsMax);
    expect(num(ladder, 'max_creator_plus_backer_bps')).toBe(FACTS.creatorPlusBackerBpsMax);
    expect(num(ladder, 'min_stream_days_small')).toBe(FACTS.streamDays.min);
    expect(num(ladder, 'max_stream_days')).toBe(FACTS.streamDays.max);
    expect(num(ladder, 'backer_vest_days')).toBe(FACTS.backerVestDays);
  });
  it('launch fee, relay fee and trade-fee bounds', () => {
    expect(num(ladder, 'launch_fee_bps') / 100).toBe(FACTS.launchFeePct);
    expect(num(ladder, 'launch_fee_min')).toBe(FACTS.launchFeeMinUsdc);
    expect(num(ladder, 'launch_fee_max')).toBe(FACTS.launchFeeMaxUsdc);
    expect(num(ladder, 'max_relay_fee_bps') / 100).toBe(FACTS.relayFeeCeilingPct);
    expect(/max_relay_fee_abs:\s*USDC \/ 2/.test(ladder)).toBe(true);
    expect(FACTS.relayFeeCeilingUsdc).toBe(0.5);
    expect(num(ladder, 'min_total_fee_bps') / 100).toBe(FACTS.tradeFeePctMin);
    expect(num(ladder, 'max_total_fee_bps') / 100).toBe(FACTS.tradeFeePctMax);
    expect(num(ladder, 'max_creator_take_bps') / 100).toBe(FACTS.creatorTakeMaxPctOfVolume);
    expect(num(ladder, 'max_opening_fee_start_bps') / 100).toBe(FACTS.openingFeeStartMaxPct);
    expect(num(ladder, 'max_opening_decay_minutes')).toBe(FACTS.openingDecayMaxMinutes);
  });
});

describe('FACTS match FeeTerms::standard()', () => {
  it('split and vesting', () => {
    const s = FACTS.split;
    expect([num(standard, 'creator_bps'), num(standard, 'platform_bps'), num(standard, 'holders_bps'), num(standard, 'lp_bps'), num(standard, 'referral_bps')].map((b) => b / 100)).toEqual([
      s.creator, s.platform, s.holders, s.lp, s.referral,
    ]);
    expect(num(standard, 'total_fee_bps') / 100).toBe(FACTS.tradeFeePctStandard);
    expect(num(standard, 'fee_vest_bps') / 100).toBe(FACTS.feeVest.pct);
    expect(num(standard, 'fee_vest_days')).toBe(FACTS.feeVest.days);
  });
});

describe('split arithmetic', () => {
  it('sums to 100 and redirects holders and referral to liquidity', () => {
    const s = FACTS.split;
    expect(s.creator + s.platform + s.holders + s.lp + s.referral).toBe(100);
    expect(effectiveSplit(s)).toEqual({ creator: 50, platform: 15, lp: 35 });
  });
  it('slice of volume at a 1% fee', () => {
    expect(slicePctOfVolume(1, 50)).toBe(0.5);
    expect(slicePctOfVolume(1, 15)).toBe(0.15);
    expect(slicePctOfVolume(1, 35)).toBe(0.35);
  });
  it('creator take rule: fee bps x creator bps stays within 1,000,000', () => {
    expect(100 * 5_000).toBeLessThanOrEqual(1_000_000);
    expect(200 * 6_000).toBeGreaterThan(1_000_000); // 2.00% fee with a 60% creator share breaks the rule
  });
  it('the fixed Solana withdrawal fee is 30000 micro-USDC and 0.3% of a $10 buy', () => {
    expect(FACTS.intentsSolanaWithdrawFeeUsdc * 1_000_000).toBe(30_000);
    expect((FACTS.intentsSolanaWithdrawFeeUsdc / FACTS.minBuyUsdc) * 100).toBeCloseTo(0.3, 10);
  });
});
