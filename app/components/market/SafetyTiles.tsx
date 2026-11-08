import type { SafetyTile, TileStatus } from '@/lib/market/tiles';
import { tileSummary } from '@/lib/market/tiles';

const WORD: Record<TileStatus, { glyph: string; word: string; cls: string }> = {
  pass: { glyph: '✓', word: 'Pass', cls: 'mkt-up' }, warn: { glyph: '!', word: 'Check', cls: 'mkt-warn' }, fail: { glyph: '✕', word: 'Fail', cls: 'mkt-down' },
  unknown: { glyph: '?', word: 'Unknown', cls: 'mkt-muted' }, info: { glyph: 'i', word: 'Info', cls: 'mkt-muted' },
};

/** Header tiles: each is a fact, its status as a word (not colour alone) and its basis. `onOpenVerify` jumps to the Verify tab. */
export function SafetyTiles({ tiles, onOpenVerify }: { tiles: SafetyTile[]; onOpenVerify(): void }) {
  const s = tileSummary(tiles);
  return (
    <section aria-labelledby="mkt-tiles-h" className="mkt-tiles-wrap">
      <div className="mkt-tiles-head">
        <h2 id="mkt-tiles-h">Safety and Verify</h2>
        <button type="button" className="mkt-link" onClick={onOpenVerify}>{s.pass} of {s.total} checks pass, {s.unknown} unknown. Recompute in your browser</button>
      </div>
      <ul className="mkt-tiles">
        {tiles.map((t) => {
          const w = WORD[t.status];
          return (
            <li key={t.id} className="mkt-tile" data-status={t.status} title={t.detail}>
              <span className="mkt-tile-label">{t.label}</span>
              <span className="mkt-tile-value">{t.value}</span>
              <span className={`mkt-tile-meta ${w.cls}`}><span aria-hidden="true">{w.glyph} </span>{w.word}<span className="mkt-muted"> · {t.basis}</span></span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
