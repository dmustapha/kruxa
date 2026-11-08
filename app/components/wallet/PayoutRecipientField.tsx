'use client';
import { useId, useMemo, useState } from 'react';
import { PAYOUT_FIXED_RULE, resolvePayoutRecipient, type PayoutMode, type PayoutResolution } from '@/lib/wallet/payout';
import { useWallet } from './WalletProvider';

export interface PayoutState { mode: PayoutMode; other: string }

/** State plus the resolved `stream_recipient` for the form. `resolution.ok` gates the Create button. */
export function usePayoutRecipient(signer: string | null, network: 'testnet' | 'mainnet'): {
  state: PayoutState; setState(s: PayoutState): void; resolution: PayoutResolution;
} {
  const [state, setState] = useState<PayoutState>({ mode: 'self', other: '' });
  const resolution = useMemo(() => resolvePayoutRecipient({ signer, mode: state.mode, other: state.other, network }), [signer, state, network]);
  return { state, setState, resolution };
}

interface Props { state: PayoutState; onChange(s: PayoutState): void; resolution: PayoutResolution; signer: string | null; disabled?: boolean }

export function PayoutRecipientField({ state, onChange, resolution, signer, disabled }: Props) {
  const { guard } = useWallet();
  const id = useId();
  const [touched, setTouched] = useState(false);
  const showError = !resolution.ok && (state.mode === 'other' ? touched : false);
  const errId = `${id}-err`;
  const ruleId = `${id}-rule`;
  return (
    <fieldset className="wlt-payout" disabled={disabled} aria-describedby={ruleId}>
      <legend>Payout recipient</legend>
      <label className="wlt-radio">
        <input type="radio" name={`${id}-mode`} checked={state.mode === 'self'} onChange={() => onChange({ ...state, mode: 'self' })} />
        <span>{signer ? <>The account I sign with: <code>{signer}</code></> : 'The account I sign with (connect a NEAR wallet to see it)'}</span>
      </label>
      <label className="wlt-radio">
        <input type="radio" name={`${id}-mode`} checked={state.mode === 'other'} onChange={() => onChange({ ...state, mode: 'other' })} />
        <span>A separate NEAR account (for example a DAO)</span>
      </label>
      {state.mode === 'other' && (
        <div>
          <label htmlFor={`${id}-input`}>NEAR account id</label>
          <input id={`${id}-input`} value={state.other} inputMode="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
            placeholder={guard.env === 'mainnet' ? 'dao.near' : 'dao.testnet'} aria-invalid={showError || undefined} aria-describedby={showError ? errId : undefined}
            aria-required onBlur={() => setTouched(true)} onChange={(e) => onChange({ ...state, other: e.target.value })} />
          {showError && !resolution.ok && <p id={errId} className="wlt-state bad" role="alert">{resolution.error}</p>}
          {resolution.ok && resolution.warning && <p className="wlt-note wlt-note-warn" role="status">{resolution.warning}</p>}
        </div>
      )}
      <p id={ruleId} className="wlt-note">
        {PAYOUT_FIXED_RULE} It must be registered on USDC; the Studio checks and warns before you sign. NEAR accounts only in v1, no Solana payout address.
      </p>
    </fieldset>
  );
}
