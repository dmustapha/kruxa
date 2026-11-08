/** Deterministic generated avatar. No image upload exists for launches yet (IR-A3), so this is a mark derived from the id and symbol,
 *  not a logo: the same launch always draws the same sigil. */
function hash(s: string): number[] {
  let h = 2166136261;
  const out: number[] = [];
  for (let i = 0; i < 12; i++) {
    for (const ch of `${s}:${i}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    out.push(h);
  }
  return out;
}

export function LaunchSigil({ id, symbol, size = 48 }: { id: string; symbol: string; size?: number }) {
  const h = hash(`${id}|${symbol}`);
  const hue = h[0]! % 360;
  const hue2 = (hue + 40 + (h[1]! % 80)) % 360;
  const cells: boolean[] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) cells.push((h[2 + y * 3 + x]! & 4) !== 0);
  const rects = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const mx = x < 3 ? x : 4 - x;
    if (cells[y * 3 + mx]) rects.push(<rect key={`${x}-${y}`} x={x + 0.5} y={y + 0.5} width="1" height="1" rx="0.2" />);
  }
  return (
    <svg width={size} height={size} viewBox="0 0 6 6" aria-hidden="true" focusable="false" style={{ flex: 'none', borderRadius: size / 5 }}>
      <rect width="6" height="6" fill={`hsl(${hue} 45% 28%)`} />
      <g fill={`hsl(${hue2} 80% 78%)`}>{rects}</g>
    </svg>
  );
}
