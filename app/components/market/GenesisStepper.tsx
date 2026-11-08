import type { GenesisStep, StepState } from '@/lib/market/genesis';

const MARK: Record<StepState, { glyph: string; word: string }> = { done: { glyph: '✓', word: 'Done' }, current: { glyph: '→', word: 'In progress' }, pending: { glyph: '○', word: 'Waiting' }, unknown: { glyph: '?', word: 'Unknown' }, skipped: { glyph: '-', word: 'Skipped' } };

/** Token-page variant: NEAR verdict to Solana mint to NEAR pool. An ordered list; the current step carries aria-current. */
export function GenesisStepper({ steps, receiptUrl }: { steps: GenesisStep[]; receiptUrl?(receipt: string): string }) {
  return (
    <ol className="mkt-stepper" aria-label="Genesis steps">
      {steps.map((s) => (
        <li key={s.id} data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="mkt-step-mark" aria-hidden="true">{MARK[s.state].glyph}</span>
          <span className="mkt-step-body">
            <strong>{s.label}</strong>
            <span className="mkt-muted"> <span className="mkt-sr">Status: </span>{MARK[s.state].word}</span>
            {s.note && <span className="mkt-step-note">{s.note}</span>}
            {s.receipt && <span className="mkt-step-note mkt-mono">{receiptUrl ? <a href={receiptUrl(s.receipt)} target="_blank" rel="noopener noreferrer">receipt {s.receipt.slice(0, 10)}...</a> : `receipt ${s.receipt.slice(0, 10)}...`}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
