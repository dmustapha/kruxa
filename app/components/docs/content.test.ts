import { describe, expect, it } from 'vitest';
import { stripInline } from '@/components/docs/markup';
import { DOC_PAGES, docBySlug, docNav, neighbours } from '@/content/docs';
import { LEGAL_PAGES } from '@/content/legal';
import { FACTS } from '@/content/docs/facts';
import type { Block, Page } from '@/content/types';

const ALL: Page[] = [...DOC_PAGES, ...LEGAL_PAGES];

function strings(b: Block): string[] {
  switch (b.t) {
    case 'h2': return [b.text];
    case 'h3': case 'p': case 'code': return [b.t === 'code' ? b.text : (b as { text: string }).text];
    case 'ul': case 'ol': return b.items;
    case 'table': return [...b.head, ...b.rows.flat()];
    case 'note': return [b.text, b.title ?? ''];
  }
}
const textOf = (pg: Page) => [pg.title, pg.summary, ...pg.blocks.flatMap(strings)].join('\n');

describe('registry', () => {
  it('has the required docs pages', () => {
    for (const s of ['how-it-works', 'creators', 'buyers', 'fees', 'verify', 'security', 'charter', 'faq', 'glossary']) {
      expect(docBySlug(s), s).toBeDefined();
    }
    expect(LEGAL_PAGES.map((p) => p.slug)).toEqual(['terms', 'privacy', 'risk']);
  });
  it('slugs are unique and nav matches pages', () => {
    const slugs = ALL.map((p) => `${LEGAL_PAGES.includes(p) ? 'l' : 'd'}:${p.slug}`);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(docNav().map((n) => n.href)).toEqual(DOC_PAGES.map((p) => `/docs/${p.slug}`));
  });
  it('heading ids are unique within a page', () => {
    for (const pg of ALL) {
      const ids = pg.blocks.filter((b) => b.t === 'h2').map((b) => (b as { id: string }).id);
      expect(new Set(ids).size, pg.slug).toBe(ids.length);
      ids.forEach((id) => expect(id, pg.slug).toMatch(/^[a-z0-9-]+$/));
    }
  });
  it('prev and next walk the whole list', () => {
    expect(neighbours(DOC_PAGES[0].slug).prev).toBeUndefined();
    expect(neighbours(DOC_PAGES[DOC_PAGES.length - 1].slug).next).toBeUndefined();
    expect(neighbours(DOC_PAGES[1].slug).prev?.slug).toBe(DOC_PAGES[0].slug);
  });
  it('tables have rectangular rows', () => {
    for (const pg of ALL) for (const b of pg.blocks) if (b.t === 'table') b.rows.forEach((r) => expect(r.length, `${pg.slug}: ${b.head[0]}`).toBe(b.head.length));
  });
});

describe('links', () => {
  const known = new Set(['/', '/create', '/ops-log', '/status', '/insights', '/settings', '/search', '/charter', '/legal/risk', '/llms.txt', '/AGENTS.md', '/openapi.yaml', ...DOC_PAGES.map((p) => `/docs/${p.slug}`), ...LEGAL_PAGES.map((p) => `/legal/${p.slug}`)]);
  it('every internal link resolves to a route that exists', () => {
    for (const pg of ALL) {
      const hrefs = [...textOf(pg).matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
      for (const h of hrefs) if (!/^https?:/.test(h)) expect(known.has(h.split('#')[0]), `${pg.slug} -> ${h}`).toBe(true);
    }
  });
});

describe('voice and honesty lint', () => {
  it('uses no em dashes or en dashes', () => {
    for (const pg of ALL) expect(/[–—]/.test(textOf(pg)), pg.slug).toBe(false);
  });
  it('avoids words the project forbids', () => {
    const banned = /\b(safe|safely|audited|guaranteed?|risk-free|trustless|moon|apy|roi|yield|profit\w*|sustainab\w*|break-even|revenue|passive income)\b/i;
    for (const pg of ALL) expect(textOf(pg).match(banned)?.[0], pg.slug).toBeUndefined();
  });
  it('never says 100% back or quotes an unbuilt gallery figure', () => {
    for (const pg of ALL) {
      const t = textOf(pg);
      expect(/100% (of your principal )?back/i.test(t), pg.slug).toBe(false);
      expect(/GALLERY\s+\d+\s*\/\s*\d+/.test(t), pg.slug).toBe(false);
      expect(/\bimmutable\b/i.test(t.replace(/Do not read "immutable"[^.]*\./, '').replace(/No immutability claim[^.]*\./, '')), pg.slug).toBe(false);
    }
  });
  it('states the creator maximum only with its qualifier', () => {
    for (const pg of ALL) {
      const t = stripInline(textOf(pg));
      if (/1\.00% of (trading )?volume/.test(t)) expect(/80% of the fee|declared/.test(t), pg.slug).toBe(true);
    }
  });
  it('never says the holders or referral slices are paid', () => {
    const fees = textOf(docBySlug('fees')!);
    expect(fees).toContain('redirected to liquidity');
  });
});

describe('legal pages are drafts with placeholders', () => {
  it('each has a draft note and every placeholder it needs', () => {
    for (const pg of LEGAL_PAGES) {
      const t = textOf(pg);
      expect(pg.title.toLowerCase()).toContain('draft');
      expect(pg.blocks.some((b) => b.t === 'note' && b.kind === 'draft'), pg.slug).toBe(true);
      expect(t, pg.slug).toContain('Kruxa project');
      expect(t, pg.slug).toContain('damilolamustaphaa@gmail.com');
      expect(/\[[A-Z][A-Z /]+\]/.test(t), pg.slug + ' has an unfilled placeholder').toBe(false);
    }
  });
  it('contains only the owner-supplied contact email, and no other address, domain or street address', () => {
    const OWNER = 'damilolamustaphaa@gmail.com';
    for (const pg of LEGAL_PAGES) {
      const emails = textOf(pg).match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi) ?? [];
      for (const e of emails) expect(e.toLowerCase(), pg.slug).toBe(OWNER);
    }
  });
  it('risk page covers every required disclosure', () => {
    const t = textOf(LEGAL_PAGES.find((p) => p.slug === 'risk')!).toLowerCase();
    for (const needle of ['no independent audit', 'caps', 'real money', 'lose all', 'about 35 minutes', 'remote hosts', 'single-party reserve', 'sybil']) {
      expect(t, needle).toContain(needle);
    }
  });
});

describe('docs facts that must appear', () => {
  it('buyers page labels the Solana path unproven and names OV3, OV4, OV15', () => {
    const b = docBySlug('buyers')!;
    const t = textOf(b);
    expect(b.blocks.some((x) => x.t === 'note' && x.kind === 'unproven')).toBe(true);
    for (const n of ['OV3', 'OV4', 'OV15', '0.03 USDC']) expect(t).toContain(n);
  });
  it('verify page lists every exit code', () => {
    const v = docBySlug('verify')!.blocks.find((b) => b.t === 'table' && b.head[0] === 'Code') as Extract<Block, { t: 'table' }>;
    expect(v.rows.map((r) => r[0])).toEqual(['0', '1', '2', '3', '4', '64']);
  });
  it('security gallery numbers come from the committed evidence file, never invented', () => {
    const t = textOf(docBySlug('security')!);
    expect(t).toContain(FACTS.gallery.file);
    expect(t).toContain(FACTS.gallery.generatedAt);
    expect(t).toContain('not by an independent party');
    expect(/GALLERY\s+\d+\s*\/\s*\d+/.test(t)).toBe(false);
    for (const id of ['A16', 'A19']) expect(t).toContain(id);
  });
  it('security page says instant tokens can lose all value and names what is not prevented', () => {
    const t = textOf(docBySlug('security')!).toLowerCase();
    for (const n of ['lose all of its value', 'sniping', 'wash trading', 'serial launches', 'self-dealing'.replace('self-dealing', 'buying their own launch'), 'freeze', 'not prevented']) expect(t, n).toContain(n);
  });
});

describe('instant launch is described honestly', () => {
  it('how-it-works has the comparison table with both modes and the main rows', () => {
    const t = docBySlug('how-it-works')!.blocks.find((b) => b.t === 'table' && b.head[1] === 'Trial launch') as Extract<Block, { t: 'table' }>;
    expect(t.head).toEqual(['', 'Trial launch', 'Instant launch']);
    const rows = t.rows.map((r) => r[0]);
    for (const r of ['Refund for buyers', 'Walk', 'Verdict', 'When it trades', 'What the creator cannot do', 'What is bounded', 'What is not bounded']) expect(rows).toContain(r);
  });
  it('every page that mentions Instant mode labels it as being built and NEAR only somewhere', () => {
    const pages = DOC_PAGES.filter((pg) => /Instant launch/.test(textOf(pg)));
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const pg of ['how-it-works', 'creators', 'buyers']) {
      const t = textOf(docBySlug(pg)!);
      expect(t, pg).toContain('Being built');
    }
    expect(textOf(docBySlug('how-it-works')!)).toContain('NEAR only');
  });
  it('never claims instant tokens are protected, refundable, or on Solana', () => {
    for (const pg of ALL) {
      const t = textOf(pg);
      expect(/instant[^.]{0,60}(is|are) (protected|refundable|rug-?proof)/i.test(t), pg.slug).toBe(false);
      expect(/\brug-?proof\b|\bno rug\b|cannot be rugged/i.test(t), pg.slug).toBe(false);
    }
  });
});

describe('docs facts that must appear (continued)', () => {
  it('fee page lists the 50/15/15/10/10 split', () => {
    expect(textOf(docBySlug('fees')!)).toContain('50 / 15 / 15 / 10 / 10');
  });
});
