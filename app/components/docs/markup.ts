// Tiny inline markup for content strings: `code`, **bold**, [label](href). No HTML is ever interpreted.
export type Inline =
  | { k: 'text'; v: string }
  | { k: 'code'; v: string }
  | { k: 'bold'; v: string }
  | { k: 'link'; v: string; href: string };

const TOKEN = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ k: 'text', v: src.slice(last, at) });
    if (m[1] !== undefined) out.push({ k: 'code', v: m[1] });
    else if (m[2] !== undefined) out.push({ k: 'bold', v: m[2] });
    else out.push({ k: 'link', v: m[3], href: m[4] });
    last = at + m[0].length;
  }
  if (last < src.length) out.push({ k: 'text', v: src.slice(last) });
  return out;
}

/** Plain text of a marked-up string, for search, ids and tests. */
export function stripInline(src: string): string {
  return parseInline(src).map((t) => t.v).join('');
}

export function slugify(s: string): string {
  return stripInline(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
