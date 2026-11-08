'use client';
// Mobile order flow: a sticky Buy / Sell bar and a bottom sheet. The sheet is a native modal <dialog>, so focus is trapped and
// Escape closes it. Sells and claims are never paused; only Buy is disabled when the market is paused.
import { useEffect, useRef, type ReactNode } from 'react';

export type SheetSide = 'buy' | 'sell';

export function StickyTradeBar({ onOpen, buyDisabledReason, sellDisabled }: { onOpen(side: SheetSide): void; buyDisabledReason: string | null; sellDisabled: boolean }) {
  return (
    <div className="mkt-sticky-bar" role="group" aria-label="Trade">
      <button type="button" className="mkt-sb-buy" disabled={!!buyDisabledReason} aria-describedby={buyDisabledReason ? 'mkt-sb-note' : undefined} onClick={() => onOpen('buy')}>Buy</button>
      <button type="button" className="mkt-sb-sell" disabled={sellDisabled} onClick={() => onOpen('sell')}>Sell</button>
      {buyDisabledReason && <p id="mkt-sb-note" className="mkt-sb-note">{buyDisabledReason}</p>}
    </div>
  );
}

export function OrderSheet({ open, onClose, children }: { open: boolean; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="mkt-sheet" aria-label="Order" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="mkt-sheet-bar"><span className="mkt-sheet-grip" aria-hidden="true" /><button type="button" className="mkt-link" onClick={onClose}>Close</button></div>
      {open && children}
    </dialog>
  );
}
