import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GALLERY_OUT, copyPlan, repoDir, summarizeGallery } from '../scripts/sync-evidence.mjs';
import { BOUNDED_ATTACKS, FACTS, GALLERY } from './docs/facts';

const galleryPath = resolve(repoDir, 'evidence/attack-gallery/attack-gallery.json');
const have = existsSync(galleryPath);

// If this file fails, run `npm run sync` in app/ and commit the result. That is the whole fix.
describe('app copies of committed evidence are current', () => {
  it.skipIf(!have)('the gallery summary equals what the evidence file says', () => {
    const src = JSON.parse(readFileSync(galleryPath, 'utf8'));
    expect(JSON.parse(readFileSync(resolve(repoDir, GALLERY_OUT), 'utf8'))).toEqual(summarizeGallery(src));
  });
  it.skipIf(!have)('every copied file is byte for byte the source', () => {
    for (const [from, to] of copyPlan()) expect(readFileSync(resolve(repoDir, to)).equals(readFileSync(resolve(repoDir, from))), `${to} differs from ${from}`).toBe(true);
  });
});

describe('the docs quote the gallery, they do not retype it', () => {
  it('FACTS.gallery is derived from the summary', () => {
    expect(FACTS.gallery.total).toBe(GALLERY.counts.total);
    expect(FACTS.gallery.bounded).toBe(BOUNDED_ATTACKS.length);
    expect(FACTS.gallery.refused + FACTS.gallery.noEffect + FACTS.gallery.bounded + FACTS.gallery.failed).toBe(FACTS.gallery.total);
    expect(GALLERY.attacks.length).toBe(GALLERY.counts.total);
  });
  it.skipIf(!have)('the numbers match the real evidence file (the stale 43 cannot come back)', () => {
    const src = JSON.parse(readFileSync(galleryPath, 'utf8'));
    expect(FACTS.gallery.total).toBe(src.counts.total);
    expect(FACTS.gallery.attackTransactions).toBe(src.counts.attack_transactions);
    expect(FACTS.gallery.generatedAt).toBe(src.generated_at);
  });
});
