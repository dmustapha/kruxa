import { ExplorerLink } from './ExplorerLink';
import type { TxState } from '@/lib/useTx';

/** Live region under an action button. A failure shows the rule code or wallet reason; success shows the hash when the wallet gave one. */
export function TxStatus({ state }: { state: TxState }) {
  return (
    <div role="status" aria-live="polite" className="hint" style={{ minHeight: 0 }}>
      {state.status === 'pending' && <span>Waiting for the wallet and the chain.</span>}
      {state.status === 'done' && <span className="ok">Submitted{state.txHash ? <> · tx <ExplorerLink kind="near-tx" value={state.txHash} /></> : ' (the wallet did not report a hash)'}{state.note ? ` · ${state.note}` : ''}</span>}
      {state.status === 'failed' && <span className="bad">{state.code ? <code>{state.code}</code> : null} {state.message}</span>}
    </div>
  );
}
