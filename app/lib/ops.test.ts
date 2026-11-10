import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPERATOR_POWERS, eventLabel, groupOf, nsToUnix } from './ops';
import { OPEN_LIMITS } from '@/content/docs/limits';

const root = resolve(__dirname, '../..');
const govern = readFileSync(resolve(root, 'contracts/core/src/govern.rs'), 'utf8');

describe('operator powers match the core contract', () => {
  it('the upgrade queue waits 7 days and a force-resolve waits 48 hours', () => {
    expect(/UPGRADE_DELAY_NS: u64 = 7 \* DAY_NS/.test(govern)).toBe(true);
    expect(/FORCE_RESOLVE_DELAY_NS: u64 = 2 \* DAY_NS/.test(govern)).toBe(true);
    expect(OPERATOR_POWERS.find((p) => p.id === 'queue_upgrade')!.delayDays).toBe(7);
    expect(OPERATOR_POWERS.find((p) => p.id === 'force_resolve_op')!.delayDays).toBe(2);
  });
  it('every named power is a real public method', () => {
    for (const id of ['queue_upgrade', 'halt_launch', 'force_resolve_op']) expect(govern, id).toContain(`pub fn ${id}(`);
  });
  it('halt_launch is owner or guardian, queue_upgrade is owner only, cancel is owner or guardian', () => {
    const body = (name: string) => govern.slice(govern.indexOf(`pub fn ${name}(`), govern.indexOf(`pub fn ${name}(`) + 300);
    expect(body('halt_launch')).toContain('require_owner_or_guardian');
    expect(body('queue_upgrade')).toContain('require_owner()');
    expect(body('cancel_upgrade')).toContain('require_owner_or_guardian');
  });
  it('the copy never claims a power can block exits except a freeze', () => {
    const blockers = OPERATOR_POWERS.filter((p) => /can block exits/i.test(p.limit)).map((p) => p.id);
    expect(blockers).toEqual(['freeze']);
  });
});

describe('open limits', () => {
  it('cover every limit the task requires', () => {
    const ids = OPEN_LIMITS.map((l) => l.id);
    for (const id of ['N-04', 'N-06', 'L-04', 'L-06', 'KEY', 'HALT', 'FORCE', 'SOLV', 'BURN', 'F0', 'FROZEN']) expect(ids).toContain(id);
  });
});

describe('helpers', () => {
  it('nsToUnix floors nanoseconds to seconds and refuses non-numbers', () => {
    expect(nsToUnix('1700000000999999999')).toBe(1700000000);
    expect(nsToUnix('abc')).toBeNull();
    expect(nsToUnix(null)).toBeNull();
  });
  it('groups events', () => {
    expect(groupOf('paused')).toBe('pauses');
    expect(groupOf('frozen')).toBe('pauses');
    expect(groupOf('upgrade_queued')).toBe('upgrades');
    expect(groupOf('halted')).toBe('halts');
    expect(groupOf('force_resolve_queued')).toBe('resolves');
    expect(groupOf('global_cap_queued')).toBe('caps');
    expect(groupOf('genesis_resumed')).toBe('other');
    expect(eventLabel('halted')).toBe('Launch halted');
    expect(eventLabel('something_new')).toBe('something new');
  });
});
