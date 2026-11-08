import { describe, expect, it, vi } from 'vitest';
import { b58decode, b58encode } from './base58';
import { buildIntentPayload, buildWalkMessage, maxRelayFee, signCommitIntent, signWalkIntent, walkSignedArgs } from './intents-commit';
import { CONFIG } from './config';

const KEY = b58encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

describe('base58', () => {
  it('round-trips, including leading zeros', () => {
    for (const bytes of [Uint8Array.from([0, 0, 1, 2, 3]), Uint8Array.from({ length: 64 }, (_, i) => (i * 7) % 256), new Uint8Array(0)]) expect(b58decode(b58encode(bytes))).toEqual(bytes);
  });
  it('matches a known vector', () => expect(b58encode(new TextEncoder().encode('hello world'))).toBe('StV1DL6CwTryKyV'));
  it('rejects non-base58 text', () => expect(() => b58decode('0OIl')).toThrow());
});

describe('commit intent payload (s4.rs strict shape)', () => {
  const p = JSON.parse(buildIntentPayload({ signerHex: 'ab'.repeat(32), launchId: '7', amountMicro: 30_000_000n, relayFeeMicro: 250_000n, solanaAddress: KEY, deadlineIso: '2027-01-01T00:00:00.000Z', nonceB64: 'AAAA' }));
  it('has exactly the contract fields', () => expect(Object.keys(p).sort()).toEqual(['deadline', 'intents', 'nonce', 'signer_id', 'verifying_contract']));
  it('is one transfer to the core contract in USDC', () => {
    expect(p.intents).toHaveLength(1);
    expect(p.intents[0]).toMatchObject({ intent: 'transfer', receiver_id: CONFIG.core, tokens: { [CONFIG.usdcTokenId]: '30000000' } });
  });
  it('memo follows kruxa:v1:t=<id>;d=sol:<key>;fee=<micro>', () => expect(p.intents[0].memo).toBe(`kruxa:v1:t=7;d=sol:${KEY};fee=250000`));
  it('relay fee ceiling is min(0.50 USDC, 5%)', () => { expect(maxRelayFee(20_000_000n)).toBe(500_000n); expect(maxRelayFee(4_000_000n)).toBe(200_000n); expect(maxRelayFee(1_000_000_000n)).toBe(500_000n); });
});

describe('walk message (intake.rs walk_signed preimage)', () => {
  it('is kruxa:walk:v1|contract|launch|holder|nonce|deadline_ns', () => {
    const m = buildWalkMessage('7', KEY, 1_700_000_000_000, 600);
    expect(m.text).toBe(`kruxa:walk:v1|${CONFIG.core}|7|sol:${KEY}|1700000000000|${(1_700_000_000n + 600n) * 1_000_000_000n}`);
  });
  it('args carry the signature as base58', () => {
    const m = buildWalkMessage('7', KEY, 5000);
    expect(walkSignedArgs('7', m, new Uint8Array(64).fill(2))).toMatchObject({ launch_id: '7', holder: `sol:${KEY}`, nonce: '5000' });
  });
});

describe('signing flows over a mock adapter', () => {
  const adapter = () => ({ signMessage: vi.fn(async (i: { message: Uint8Array }) => ({ chain: 'solana' as const, address: KEY, signature: new Uint8Array(64).fill(9), signedMessage: i.message })) });
  it('commit signs the UTF-8 bytes of the payload and returns a raw_ed25519 bundle', async () => {
    const a = adapter();
    const { payload, bundle } = await signCommitIntent({ adapter: a, address: KEY, launchId: '7', amountMicro: 30_000_000n, relayFeeMicro: 0n, nowMs: 1_700_000_000_000 });
    expect(new TextDecoder().decode(a.signMessage.mock.calls[0]![0].message)).toBe(payload);
    expect(bundle).toMatchObject({ standard: 'raw_ed25519', payload, public_key: `ed25519:${KEY}` });
    expect(bundle.signature.startsWith('ed25519:')).toBe(true);
    expect(JSON.parse(payload).signer_id).toBe(Array.from(b58decode(KEY), (x) => x.toString(16).padStart(2, '0')).join(''));
  });
  it('walk signs the preimage text', async () => {
    const a = adapter();
    const { message } = await signWalkIntent({ adapter: a, address: KEY, launchId: '7', nowMs: 1_700_000_000_000 });
    expect(new TextDecoder().decode(a.signMessage.mock.calls[0]![0].message)).toBe(message.text);
  });
  it('a rejected signature propagates, nothing is returned', async () => {
    const a = { signMessage: vi.fn(async () => { throw new Error('You rejected the signature request.'); }) };
    await expect(signCommitIntent({ adapter: a, address: KEY, launchId: '7', amountMicro: 1n, relayFeeMicro: 0n })).rejects.toThrow('rejected');
  });
});
