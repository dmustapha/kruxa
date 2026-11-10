// Section B of /insights renders the committed thesis pack as RECORDED data. Nothing is fetched and nothing is recomputed here:
// the app reads copies of thesis/results/results.json and thesis/dashboard/* kept under public/thesis/ (lib/thesis.test.ts fails if a copy drifts
// from the source in the repository; refresh with `npm run sync:thesis`). The pack is produced offline by `make thesis` from committed snapshots.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ThesisChart { id: string; title: string; desc: string; reading: string; meta: string; query: string }
export interface ThesisHeadline { bestR: number; bestLag: number; p: number; null95: number; n: number; deltaR2: number; incrementalP: number }

const dir = (): string => join(process.cwd(), 'public', 'thesis');
const text = (h: string): string => h.replace(/<[^>]+>/g, '').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** Pulls each chart card (title, accessible description, one plain sentence, data line, query file name) out of the committed dashboard page. */
export function parseDashboard(html: string): ThesisChart[] {
  const out: ThesisChart[] = [];
  for (const m of html.matchAll(/<section class=card id=([a-z_]+)>([\s\S]*?)<\/section>/g)) {
    const body = m[2]!;
    out.push({
      id: m[1]!,
      title: text(/<h2>([\s\S]*?)<\/h2>/.exec(body)?.[1] ?? m[1]!),
      desc: text(/<desc[^>]*>([\s\S]*?)<\/desc>/.exec(body)?.[1] ?? ''),
      reading: text(/<p class=read>([\s\S]*?)<\/p>/.exec(body)?.[1] ?? '').replace(/^Reading\.\s*/, ''),
      meta: text(/<p class=meta>([\s\S]*?)<\/p>/.exec(body)?.[1] ?? ''),
      query: /<summary>Query: (?:queries\/)?([^<]+)<\/summary>/.exec(body)?.[1] ?? 'unknown',
    });
  }
  return out;
}

export function headlineOf(r: { leaders: { tx_intents: { best_r: number; best_lag: number; p_perm: number; null95: number; n: number } }; incremental: { delta_r2: number; p_perm: number } }): ThesisHeadline {
  const l = r.leaders.tx_intents;
  return { bestR: l.best_r, bestLag: l.best_lag, p: l.p_perm, null95: l.null95, n: l.n, deltaR2: r.incremental.delta_r2, incrementalP: r.incremental.p_perm };
}

export function loadThesis(): { charts: ThesisChart[]; headline: ThesisHeadline } | null {
  try {
    const charts = parseDashboard(readFileSync(join(dir(), 'index.html'), 'utf8'));
    const headline = headlineOf(JSON.parse(readFileSync(join(dir(), 'results.json'), 'utf8')));
    return charts.length ? { charts, headline } : null;
  } catch { return null; }
}
