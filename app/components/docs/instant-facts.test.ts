import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACTS } from '@/content/docs/facts';

const root = resolve(__dirname, '../../..');

// Instant launcher constants. The launcher is not in main yet: point KRUXA_INSTANT_ROOT at its checkout, or the
// test is skipped (it runs automatically once crates/kruxa-instant lands in this repo).
const instantRoot = process.env.KRUXA_INSTANT_ROOT ?? root;
const paramsPath = resolve(instantRoot, 'crates/kruxa-instant/src/params.rs');
const libPath = resolve(instantRoot, 'contracts/instant/src/lib.rs');
const haveInstant = existsSync(paramsPath) && existsSync(libPath);

function c(src: string, name: string): number {
  const m = new RegExp(`${name}:\\s*[a-z0-9]+\\s*=\\s*([0-9_]+)`).exec(src);
  if (!m) throw new Error(`const not found: ${name}`);
  return Number(m[1].replace(/_/g, ''));
}

describe.skipIf(!haveInstant)('FACTS.instant match the launcher code', () => {
  const params = haveInstant ? readFileSync(paramsPath, 'utf8') : '';
  const lib = haveInstant ? readFileSync(libPath, 'utf8') : '';
  const I = FACTS.instant;
  it('supply, allocation, cliff and vest', () => {
    expect(c(params, 'TOTAL_SUPPLY_WHOLE')).toBe(I.supplyWhole);
    expect(c(params, 'TOKEN_DECIMALS')).toBe(I.tokenDecimals);
    expect(c(params, 'MAX_ALLOC_BPS')).toBe(I.allocBpsMax);
    expect(c(params, 'DEFAULT_ALLOC_BPS')).toBe(I.allocBpsDefault);
    expect(c(params, 'MIN_CLIFF_DAYS')).toBe(I.cliffDays.min);
    expect(c(params, 'MAX_CLIFF_DAYS')).toBe(I.cliffDays.max);
    expect(c(params, 'DEFAULT_CLIFF_DAYS')).toBe(I.cliffDays.default);
    expect(c(params, 'MIN_VEST_DAYS')).toBe(I.vestDays.min);
    expect(c(params, 'MAX_VEST_DAYS')).toBe(I.vestDays.max);
    expect(c(params, 'DEFAULT_VEST_DAYS')).toBe(I.vestDays.default);
  });
  it('seed range, fee and caps', () => {
    expect(c(params, 'MIN_SEED_Q') / 1e6).toBe(I.seedUsdc.min);
    expect(c(params, 'MAX_SEED_Q') / 1e6).toBe(I.seedUsdc.max);
    expect(c(params, 'DEFAULT_SEED_Q') / 1e6).toBe(I.seedUsdc.default);
    expect(c(lib, 'MAINNET_LAUNCH_FEE') / 1e6).toBe(I.launchFeeMainnetUsdc);
    expect(c(lib, 'AGG_SEED_CAP') / 1e6).toBe(I.seedAggregateCapUsdc);
    expect(c(lib, 'RATE_LIMIT_UNITS') * 24).toBe(I.rateLimitHours);
    expect(c(lib, 'ABANDON_UNITS') * 24).toBe(I.abandonHours);
    expect(c(lib, 'ABORT_UNITS') * 24).toBe(I.abortHours);
  });
  it('opening fee and reserved symbols', () => {
    expect(params).toContain(`opening_fee_start_bps: ${I.openingFeeStartBps}`);
    expect(params).toContain(`opening_decay_minutes: ${I.openingDecayMinutes}`);
    expect(params).toContain('"KRUXA"');
  });
});

describe('FACTS.gallery match the committed evidence file', () => {
  const path = resolve(root, FACTS.gallery.file);
  it.skipIf(!existsSync(path))('counts, network and timestamp', () => {
    const d = JSON.parse(readFileSync(path, 'utf8'));
    const g = FACTS.gallery;
    expect(d.network).toBe(g.network);
    expect(d.generated_at).toBe(g.generatedAt);
    expect(d.counts).toMatchObject({
      total: g.total, refused: g.refused, no_effect: g.noEffect, bounded: g.bounded, failed: g.failed,
      succeeded_unexpectedly: g.succeededUnexpectedly, attack_transactions: g.attackTransactions,
    });
    expect(g.refused + g.noEffect + g.bounded + g.failed).toBe(g.total);
    const bounded = d.attacks.filter((a: { result: string }) => a.result === 'BOUNDED').map((a: { id: string }) => a.id).sort();
    expect(bounded).toEqual(['A16', 'A19', 'I06', 'I29', 'I36']);
  });
});
