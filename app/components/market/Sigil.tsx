// Generated avatar (Dami: generated avatars, no uploads). Deterministic from the launch id and symbol: a mirrored 5x5 grid and a hue.
// Decorative, so it is hidden from assistive tech; the symbol is always printed beside it.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function sigilCells(seed: string): boolean[][] {
  let h = hash(seed);
  const next = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = (h ^ (h >>> 13)) >>> 0; return h; };
  return Array.from({ length: 5 }, () => {
    const half = [next() & 1, next() & 1, next() & 1].map(Boolean);
    return [half[0]!, half[1]!, half[2]!, half[1]!, half[0]!];
  });
}

export function Sigil({ id, symbol, size = 40 }: { id: string; symbol: string; size?: number }) {
  const seed = `${id}:${symbol}`;
  const hue = hash(seed) % 360;
  const cells = sigilCells(seed);
  return (
    <svg width={size} height={size} viewBox="0 0 5 5" aria-hidden="true" focusable="false" style={{ borderRadius: 10, background: `hsl(${hue} 35% 18%)`, flex: 'none' }} shapeRendering="crispEdges">
      {cells.map((row, y) => row.map((on, x) => (on ? <rect key={`${x}${y}`} x={x} y={y} width="1" height="1" fill={`hsl(${hue} 80% 68%)`} /> : null)))}
    </svg>
  );
}
