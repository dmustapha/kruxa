import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseIds, parseSettings, toggleId } from './settings';

describe('parseSettings', () => {
  it('falls back to defaults for nothing, junk or the wrong type', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
  });
  it('keeps valid fields and repairs bad ones one by one', () => {
    const s = parseSettings(JSON.stringify({ slippagePct: '3', buyPresets: [10, 20, 30], nearRpc: 'https://rpc.example/x', solanaRpc: 'http://insecure', timeDisplay: 'local', reducedMotion: true, showFixture: false }));
    expect(s).toMatchObject({ slippagePct: '3', buyPresets: [10, 20, 30], nearRpc: 'https://rpc.example/x', solanaRpc: '', timeDisplay: 'local', reducedMotion: true, showFixture: false });
    expect(parseSettings(JSON.stringify({ slippagePct: '99', buyPresets: [1, 2] })).slippagePct).toBe('1');
    expect(parseSettings(JSON.stringify({ buyPresets: [1, 2] })).buyPresets).toEqual([5, 25, 100]);
  });
});

describe('id lists', () => {
  it('keeps only numeric launch ids, without duplicates', () => {
    expect(parseIds(JSON.stringify(['1', '2', '2', 'x', 3, '<script>']))).toEqual(['1', '2']);
    expect(parseIds('bad')).toEqual([]);
    expect(parseIds(null)).toEqual([]);
  });
  it('toggles', () => {
    expect(toggleId(['1'], '2')).toEqual(['1', '2']);
    expect(toggleId(['1', '2'], '1')).toEqual(['2']);
  });
});
