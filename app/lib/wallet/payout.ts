// Payout recipient rules (PRD 4b.2): default is the account that signs create_trial; optionally a separate NEAR account;
// fixed once the trial opens; NEAR accounts only in v1 (no Solana payout address).

export const PAYOUT_FIXED_RULE =
  'Fixed once the trial opens. The submission build has no method that changes it. It is part of the Charter hash.';

const SEGMENT = /^([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT_HEX = /^[0-9a-f]{64}$/;

export type AccountIdCheck = { ok: true; accountId: string; warning?: string } | { ok: false; error: string };

/** NEAR account id syntax: 2 to 64 chars, lowercase letters, digits, and single - _ separators, dot-separated parts. */
export function validateNearAccountId(raw: string, network: 'testnet' | 'mainnet' = 'testnet'): AccountIdCheck {
  const id = raw.trim();
  if (id.length === 0) return { ok: false, error: 'Enter a NEAR account id.' };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id) && id !== id.toLowerCase()) {
    return { ok: false, error: 'This looks like a Solana address. Payouts go to a NEAR account in v1.' };
  }
  if (id !== id.toLowerCase()) return { ok: false, error: 'NEAR account ids are lowercase.' };
  if (id.length < 2 || id.length > 64) return { ok: false, error: 'A NEAR account id is 2 to 64 characters.' };
  if (IMPLICIT_HEX.test(id)) return { ok: true, accountId: id };
  if (!id.split('.').every((part) => SEGMENT.test(part))) {
    return { ok: false, error: 'Use lowercase letters, digits and single - or _ between parts; no leading, trailing or doubled separators.' };
  }
  if (network === 'testnet' && !id.endsWith('.testnet')) {
    return { ok: true, accountId: id, warning: 'Testnet accounts normally end in .testnet. Check the id.' };
  }
  if (network === 'mainnet' && id.endsWith('.testnet')) {
    return { ok: false, error: 'A .testnet account cannot receive mainnet payouts.' };
  }
  return { ok: true, accountId: id };
}

export type PayoutMode = 'self' | 'other';
export type PayoutResolution = { ok: true; accountId: string; isSeparate: boolean; warning?: string } | { ok: false; error: string };

/** Decides the `stream_recipient` value. `self` needs the signer; `other` needs a valid separate account. */
export function resolvePayoutRecipient(args: { signer: string | null; mode: PayoutMode; other: string; network?: 'testnet' | 'mainnet' }): PayoutResolution {
  if (args.mode === 'self') {
    if (!args.signer) return { ok: false, error: 'Connect a NEAR account to use it as the payout recipient.' };
    return { ok: true, accountId: args.signer, isSeparate: false };
  }
  const check = validateNearAccountId(args.other, args.network);
  if (!check.ok) return check;
  return { ok: true, accountId: check.accountId, isSeparate: check.accountId !== args.signer, warning: check.warning };
}
