import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ENDPOINTS, agentsMd, llmsTxt } from './agent';

const root = resolve(__dirname, '../..');
const yamlPath = resolve(root, 'docs/interfaces/api.openapi.yaml');
const yaml = existsSync(yamlPath) ? readFileSync(yamlPath, 'utf8') : '';

describe('agent layer lists every API path', () => {
  it.skipIf(!yaml)('every path in the OpenAPI file is listed, and nothing else', () => {
    const paths = [...yaml.matchAll(/^ {2}(\/api\/[^:\s]+):/gm)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(10);
    expect(API_ENDPOINTS.map((e) => e.path).sort()).toEqual(paths.sort());
  });
  it.skipIf(!yaml)('the served /openapi.yaml is the committed interface file', () => {
    expect(readFileSync(resolve(__dirname, '../public/openapi.yaml'), 'utf8')).toBe(yaml);
  });
});

describe('llms.txt and AGENTS.md', () => {
  const texts = { 'llms.txt': llmsTxt('http://api.example'), 'AGENTS.md': agentsMd('http://api.example') };
  it('say read only, and name the API base', () => {
    for (const [n, t] of Object.entries(texts)) { expect(t, n).toMatch(/Read only/); expect(t, n).toContain('http://api.example'); }
  });
  it('contain every endpoint', () => {
    for (const [n, t] of Object.entries(texts)) for (const e of API_ENDPOINTS) expect(t, `${n} ${e.path}`).toContain(e.path);
  });
  it('use no em or en dashes', () => {
    for (const [n, t] of Object.entries(texts)) expect(/[\u2013\u2014]/.test(t), n).toBe(false);
  });
  it('never claim audit, trustlessness, yield or safety except as things not to claim', () => {
    const t = llmsTxt('x');
    expect(/\b(audited|trustless|immutable|safe|yield|apy|guaranteed)\b/i.test(t)).toBe(false);
    expect(agentsMd('x')).toMatch(/Do not call Kruxa audited/);
  });
  it('llms.txt follows the format: an h1, a blockquote summary, and link sections', () => {
    const t = texts['llms.txt'];
    expect(t.startsWith('# Kruxa\n\n> ')).toBe(true);
    expect(t).toMatch(/\n## Read-only API\n/);
  });
});
