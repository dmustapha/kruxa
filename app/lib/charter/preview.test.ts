import { describe, expect, it } from 'vitest';
import { agreement, askContract, extractCodes } from './preview';
import { PRESETS } from './presets';

const p = { ...PRESETS[0]!.params, symbol: 'ZED', name: 'Zed' };

describe('askContract', () => {
  it('uses preview_charter when the contract has it', async () => {
    const a = await askContract(p, async () => ({ ok: true, codes: [], deposit: '123' }));
    expect(a).toEqual({ kind: 'ok', via: 'preview_charter', deposit: '123' });
  });
  it('reads refusal codes from preview_charter', async () => {
    const a = await askContract(p, async () => ({ ok: false, codes: [{ code: 'R_ALLOC' }, 'R_WINDOW'] }));
    expect(a).toMatchObject({ kind: 'refused', via: 'preview_charter', codes: ['R_ALLOC', 'R_WINDOW'] });
  });
  it('falls back to required_deposit when preview_charter does not exist', async () => {
    const calls: string[] = [];
    const a = await askContract(p, async (m) => { calls.push(m); if (m === 'preview_charter') throw new Error('MethodNotFound: no such method'); return '5000'; });
    expect(calls).toEqual(['preview_charter', 'required_deposit']);
    expect(a).toEqual({ kind: 'ok', via: 'required_deposit', deposit: '5000' });
  });
  it('reads the first rule code out of a required_deposit panic', async () => {
    const a = await askContract(p, async (m) => { throw new Error(m === 'preview_charter' ? 'MethodNotFound' : 'Smart contract panicked: R_SOFT_CAP soft_cap 1 not in range'); });
    expect(a).toMatchObject({ kind: 'refused', via: 'required_deposit', codes: ['R_SOFT_CAP'] });
  });
  it('says unreachable, never refused, when the RPC is down', async () => {
    const a = await askContract(p, async () => { throw new Error('fetch failed'); });
    expect(a.kind).toBe('unreachable');
  });
});

describe('helpers', () => {
  it('extractCodes de-duplicates', () => expect(extractCodes('R_A and R_A then R_B_2')).toEqual(['R_A', 'R_B_2']));
  it('agreement is n/a when unreachable and disagrees when only the contract refuses', () => {
    expect(agreement([], { kind: 'unreachable', message: 'x' })).toBe('n/a');
    expect(agreement([], { kind: 'refused', via: 'required_deposit', codes: ['R_ALLOC'], message: '' })).toBe('disagree');
    expect(agreement([{ code: 'R_ALLOC', field: '', got: '', limit: '' }], { kind: 'refused', via: 'required_deposit', codes: ['R_ALLOC'], message: '' })).toBe('agree');
  });
});
