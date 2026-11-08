'use client';
export type LaunchModeChoice = 'trial' | 'instant';

const CARDS: { id: LaunchModeChoice; title: string; tag: string; body: string }[] = [
  { id: 'trial', title: 'Trial launch', tag: 'Refundable trial', body: 'Backers commit refundable USDC. If your soft cap and minimum backers are met when the Walk window ends, the trial passes and your token starts trading. If not, everyone is refunded. Backers can Walk until the deadline.' },
  { id: 'instant', title: 'Instant launch', tag: 'Higher risk', body: 'Your token is created now and trades at once on a pool you seed with your own USDC. There is no trial, no verdict and no refund for buyers. Your seed stays in the pool for good. Your token allocation unlocks slowly.' },
];

/** Radio cards at the top of Create. Trial is the default. Instant says what it is not, in the card, before anything else. */
export function ModeSelector({ mode, onChange, instantDisabledReason }: { mode: LaunchModeChoice; onChange: (m: LaunchModeChoice) => void; instantDisabledReason?: string | null }) {
  return (
    <fieldset className="modes" aria-label="Launch type">
      <legend className="eyebrow">Launch type</legend>
      <div className="modes-grid" role="radiogroup" aria-label="Launch type">
        {CARDS.map((c) => {
          const disabled = c.id === 'instant' && !!instantDisabledReason;
          return (
            <label key={c.id} className={`mode-card${mode === c.id ? ' on' : ''}${disabled ? ' off' : ''}`}>
              <input type="radio" name="launch-mode" value={c.id} checked={mode === c.id} disabled={disabled} onChange={() => onChange(c.id)} />
              <span className="mode-title">{c.title}<span className={`mode-tag${c.id === 'instant' ? ' risk' : ''}`}>{c.tag}</span></span>
              <span className="mode-body">{c.body}</span>
              {disabled && <span className="mode-body warn">{instantDisabledReason}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
