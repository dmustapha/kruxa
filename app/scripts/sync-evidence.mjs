// Copies the committed evidence the app displays into app/, so the app builds and deploys from app/ alone while the numbers stay tied to the
// source files. A test (content/evidence-sync.test.ts) fails when any copy differs from what this script would write from the repository.
//   node scripts/sync-evidence.mjs           write the copies
//   npm run sync                              same
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const appDir = resolve(here, '..');
export const repoDir = resolve(appDir, '..');

/** The fields the app reads from evidence/attack-gallery/attack-gallery.json. Nothing is added or computed. */
export function summarizeGallery(g) {
  return {
    schema: 'kruxa.attack-gallery.summary/1',
    source: 'evidence/attack-gallery/attack-gallery.json',
    network: g.network,
    generated_at: g.generated_at,
    git_head: g.git_head,
    counts: g.counts,
    attacks: g.attacks.map((a) => ({ id: a.id, title: a.title, result: a.result, expected_rule_code: a.expected_rule_code ?? null })),
    not_done: g.not_done,
  };
}

/** [from, to] pairs of files copied byte for byte. */
export function copyPlan() {
  const plan = [
    ['docs/interfaces/api.openapi.yaml', 'app/public/openapi.yaml'],
    ['thesis/dashboard/index.html', 'app/public/thesis/index.html'],
    ['thesis/results/results.json', 'app/public/thesis/results.json'],
    ['thesis/THESIS.md', 'app/public/thesis/THESIS.md'],
  ];
  const charts = resolve(repoDir, 'thesis/dashboard/charts');
  if (existsSync(charts)) for (const f of readdirSync(charts).filter((n) => n.endsWith('.svg')).sort()) plan.push([`thesis/dashboard/charts/${f}`, `app/public/thesis/charts/${f}`]);
  return plan;
}

export const GALLERY_OUT = 'app/content/docs/attack-gallery.summary.json';

export function run() {
  const gallery = JSON.parse(readFileSync(resolve(repoDir, 'evidence/attack-gallery/attack-gallery.json'), 'utf8'));
  const out = resolve(repoDir, GALLERY_OUT);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(summarizeGallery(gallery), null, 1) + '\n');
  for (const [from, to] of copyPlan()) {
    mkdirSync(dirname(resolve(repoDir, to)), { recursive: true });
    copyFileSync(resolve(repoDir, from), resolve(repoDir, to));
  }
  console.log(`synced ${copyPlan().length + 1} files`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
