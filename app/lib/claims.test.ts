// Guards the MUST NOT CLAIM list: these strings may not appear in app source until a committed run produces them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_STRINGS } from './claims';

const root = join(__dirname, '..');
const skip = new Set(['node_modules', '.next']);
const DEFINES_LIST = join('lib', 'claims.ts');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (skip.has(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css|md)$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

describe('forbidden strings', () => {
  const files = walk(root);
  it('scans real files', () => expect(files.length).toBeGreaterThan(30));
  for (const s of FORBIDDEN_STRINGS) it(`"${s}" is absent from app source`, () => expect(files.filter((f) => !f.endsWith(DEFINES_LIST) && readFileSync(f, 'utf8').includes(s))).toEqual([]));
  it('no em-dash or en-dash in app source', () => expect(files.filter((f) => /[–—]/.test(readFileSync(f, 'utf8')))).toEqual([]));
});
