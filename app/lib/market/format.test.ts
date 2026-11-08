import { describe, expect, it } from 'vitest';
import { fmtBps, fmtCompact, fmtPct, fmtPrice, fmtTokensCompact, fmtUnits, fmtUsdcMicro, parseUnits, shortAccount, timeAgo } from './format';

describe('format', () => {
  it('formats base units without losing precision', () => {
    expect(fmtUnits('123456789012345678901234567890', 6, 2)).toBe('123,456,789,012,345,678,901,234.56');
    expect(fmtUsdcMicro('26571793')).toBe('$26.57');
    expect(fmtUsdcMicro('1000000')).toBe('$1');
    expect(fmtUsdcMicro(null)).toBe('unknown');
    expect(fmtUnits('abc')).toBe('unknown');
  });
  it('compacts token amounts', () => {
    expect(fmtTokensCompact('794353574700')).toBe('794.35K');
    expect(fmtTokensCompact('794353574700000000')).toBe('794.35B');
    expect(fmtCompact(12)).toBe('12');
  });
  it('prints tiny prices without exponent notation', () => {
    expect(fmtPrice(0.000034161445)).toBe('$0.00003416');
    expect(fmtPrice(1.5)).toBe('$1.5000');
    expect(fmtPrice(null)).toBe('unknown');
    expect(fmtPrice(3.4e-9)).not.toMatch(/e/);
  });
  it('signs percent and bps', () => {
    expect(fmtPct(62.9927)).toBe('+62.99%');
    expect(fmtPct(-3)).toBe('-3.00%');
    expect(fmtBps(100)).toBe('1%');
    expect(fmtBps(1550)).toBe('15.5%');
  });
  it('parses decimal input strictly', () => {
    expect(parseUnits('12.5')).toBe(12_500_000n);
    expect(parseUnits('.5')).toBe(500_000n);
    expect(parseUnits('1.0000001')).toBeNull();
    expect(parseUnits('1e3')).toBeNull();
    expect(parseUnits('')).toBeNull();
    expect(parseUnits('-1')).toBeNull();
  });
  it('shortens accounts and times', () => {
    expect(shortAccount('alice.testnet')).toBe('alice.testnet');
    expect(shortAccount('a'.repeat(64))).toContain('…');
    expect(timeAgo(100, 130)).toBe('30s ago');
    expect(timeAgo(100, 100 + 7200)).toBe('2h ago');
  });
});
