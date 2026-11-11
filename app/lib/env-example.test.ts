import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = resolve(__dirname, '..');
function sources(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (['node_modules', '.next', 'public'].includes(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

describe('.env.example is complete', () => {
  const example = readFileSync(join(app, '.env.example'), 'utf8');
  const keys = new Set(sources(app).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)].map((m) => m[1]!)));
  it('lists every NEXT_PUBLIC key the code reads', () => {
    const missing = [...keys].filter((k) => !new RegExp(`^#?\\s*${k}=`, 'm').test(example) && k !== 'NEXT_PUBLIC_X');
    expect(missing).toEqual([]);
    expect(keys.size).toBeGreaterThan(10);
  });
  it('never sets the mainnet confirmation, only mentions it commented out', () => {
    expect(/^NEXT_PUBLIC_MAINNET_CONFIRMED=/m.test(example)).toBe(false);
    expect(/^NEXT_PUBLIC_NEAR_NETWORK=testnet$/m.test(example)).toBe(true);
  });
  it('holds no secret-looking values', () => {
    expect(/(secret|private|seed phrase|api[_-]?key)\s*=/i.test(example)).toBe(false);
  });
  it('.env.testnet names the live testnet stack, only testnet, no secrets', () => {
    const live = readFileSync(join(app, '.env.testnet'), 'utf8');
    for (const k of ['CORE_ACCOUNT=core3.kxi-root-1108.testnet', 'MARKET_ACCOUNT=market3.kxi-root-1108.testnet', 'USDC_ACCOUNT=usdc.kxi-root-1108.testnet', 'INSTANT_ACCOUNT=demo-instant.kxi-root-1108.testnet', 'FACTORY_ACCOUNT=factory.kxi-root-0811.testnet']) expect(live).toContain(`NEXT_PUBLIC_${k}`);
    expect(/^NEXT_PUBLIC_NEAR_NETWORK=testnet$/m.test(live)).toBe(true);
    expect(/^NEXT_PUBLIC_MAINNET_CONFIRMED=/m.test(live)).toBe(false);
    expect(/(secret|private|seed phrase|api[_-]?key)\s*=/i.test(live)).toBe(false);
    for (const k of [...keys].filter((x) => x !== 'NEXT_PUBLIC_X' && x !== 'NEXT_PUBLIC_MAINNET_CONFIRMED')) expect(new RegExp(`^#?\\s*${k}=`, 'm').test(live), k).toBe(true);
  });
});
