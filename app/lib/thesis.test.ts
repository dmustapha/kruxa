import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadThesis, parseDashboard } from './thesis';

const src = resolve(__dirname, '../../thesis');
const pub = resolve(__dirname, '../public/thesis');
const have = existsSync(src);

describe('public/thesis is an exact copy of the committed thesis pack', () => {
  it.skipIf(!have)('dashboard, results, THESIS.md and every chart', () => {
    expect(readFileSync(resolve(pub, 'index.html'), 'utf8')).toBe(readFileSync(resolve(src, 'dashboard/index.html'), 'utf8'));
    expect(readFileSync(resolve(pub, 'results.json'), 'utf8')).toBe(readFileSync(resolve(src, 'results/results.json'), 'utf8'));
    expect(readFileSync(resolve(pub, 'THESIS.md'), 'utf8')).toBe(readFileSync(resolve(src, 'THESIS.md'), 'utf8'));
    const charts = readdirSync(resolve(src, 'dashboard/charts')).filter((f) => f.endsWith('.svg'));
    expect(charts.length).toBeGreaterThan(5);
    for (const f of charts) expect(readFileSync(resolve(pub, 'charts', f), 'utf8'), f).toBe(readFileSync(resolve(src, 'dashboard/charts', f), 'utf8'));
  });
});

describe('thesis loader', () => {
  it('parses a card: title, accessible description, sentence, data line and query file', () => {
    const html = '<section class=card id=a_b><h2>Title &amp; more</h2><svg><title id="t">T</title><desc id="d">Line chart</desc></svg><p class=read><strong>Reading.</strong> It fell.</p><p class=meta>Data &middot; sha256 <code>abc</code></p><details><summary>Query: queries/01_x.sql</summary></details></section>';
    expect(parseDashboard(html)).toEqual([{ id: 'a_b', title: 'Title & more', desc: 'Line chart', reading: 'It fell.', meta: 'Data · sha256 abc', query: '01_x.sql' }]);
  });
  it('loads the committed pack with a headline that is not supported by the data', () => {
    const t = loadThesis();
    expect(t).not.toBeNull();
    expect(t!.charts.length).toBe(11);
    for (const c of t!.charts) { expect(c.reading.length, c.id).toBeGreaterThan(10); expect(c.query, c.id).toMatch(/\.sql$/); expect(existsSync(resolve(pub, 'charts', `${c.id}.svg`)), c.id).toBe(true); }
    expect(t!.headline.p).toBeGreaterThan(0.05);
  });
});
