// Solana-only buyer paths: one signed Intents transfer to the core contract (commit) and one signed walk message.
// Formats come from contracts/core/src/s4.rs (strict payload) and intake.rs (walk preimage). What is NOT proven:
//   - OV3: Phantom `signMessage` byte-exactness for the Intents `raw_ed25519` payload has never run with a real Phantom (PD-2).
//   - the Intents nonce and deadline encodings below follow the Verifier docs and are [UNVERIFIED] against live intents.near.
// So every screen that uses this says "unproven" and nothing here is presented as a result the real path produced.
import { b58decode, b58encode } from './base58';
import { CONFIG } from './config';

export const OV3_NOTE = 'Phantom signMessage byte-exactness for this payload is unproven (PD-2). The leg is labelled UNPROVEN until a real Phantom signs it and the verifier recomputes the intent hash.';

export interface IntentPayloadInput {
  /** Lowercase 64-hex of the Solana public key (the Intents account id). */
  signerHex: string;
  launchId: string;
  amountMicro: bigint;
  relayFeeMicro: bigint;
  solanaAddress: string;
  /** ISO 8601 UTC. */
  deadlineIso: string;
  /** base64 of 32 bytes. */
  nonceB64: string;
}

/** The exact string the buyer signs. Key order is fixed so the same inputs always give the same bytes. */
export function buildIntentPayload(i: IntentPayloadInput): string {
  const memo = `kruxa:v1:t=${i.launchId};d=sol:${i.solanaAddress};fee=${i.relayFeeMicro.toString()}`;
  return JSON.stringify({
    signer_id: i.signerHex,
    verifying_contract: CONFIG.intents,
    deadline: i.deadlineIso,
    nonce: i.nonceB64,
    intents: [{ intent: 'transfer', receiver_id: CONFIG.core, tokens: { [CONFIG.usdcTokenId]: i.amountMicro.toString() }, memo }],
  });
}

export interface SignedBundle { standard: 'raw_ed25519'; payload: string; public_key: string; signature: string }

export const bundleFromSignature = (payload: string, address: string, signature: Uint8Array): SignedBundle => ({
  standard: 'raw_ed25519', payload, public_key: `ed25519:${address}`, signature: `ed25519:${b58encode(signature)}`,
});

export const randomNonceB64 = (): string => {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
};

/** Relay fee ceiling from the contract: min(0.50 USDC, 5% of the gross amount). */
export const maxRelayFee = (gross: bigint): bigint => {
  const bps = (gross * 500n) / 10_000n;
  return bps < 500_000n ? bps : 500_000n;
};

export interface WalkMessage { text: string; nonce: bigint; deadlineNs: bigint; holder: string }

/** `kruxa:walk:v1|<contract>|<launch_id>|<holder key>|<nonce>|<deadline_ns>` (intake.rs walk_signed). Nonce must increase per key. */
export function buildWalkMessage(launchId: string, solanaAddress: string, nowMs: number, ttlSeconds = 600): WalkMessage {
  const holder = `sol:${solanaAddress}`;
  const nonce = BigInt(nowMs);
  const deadlineNs = (BigInt(Math.floor(nowMs / 1000) + ttlSeconds)) * 1_000_000_000n;
  return { text: `kruxa:walk:v1|${CONFIG.core}|${launchId}|${holder}|${nonce}|${deadlineNs}`, nonce, deadlineNs, holder };
}

export const walkSignedArgs = (launchId: string, m: WalkMessage, signature: Uint8Array) => ({
  launch_id: launchId, holder: m.holder, nonce: m.nonce.toString(), deadline: m.deadlineNs.toString(), signature: b58encode(signature),
});

export const isLikelySolanaKey = (s: string): boolean => { try { return b58decode(s).length === 32; } catch { return false; } };

/** Submits a signed bundle through the relayer when one is configured. Returns null when none is: the caller shows the bundle for self-submission. */
export async function relaySubmit(kind: 'commit' | 'walk', body: unknown, fetchFn: typeof fetch = fetch): Promise<{ ok: boolean; message: string } | null> {
  if (!CONFIG.relayer) return null;
  try {
    const res = await fetchFn(`${CONFIG.relayer}/submit/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    return { ok: res.ok, message: text.slice(0, 300) };
  } catch {
    return { ok: false, message: 'The relayer could not be reached. Submit the bundle yourself.' };
  }
}
