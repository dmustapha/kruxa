// The read-only agent layer: the endpoint list quoted on /docs/api, in /llms.txt and in /AGENTS.md. One source, so the three cannot disagree.
// content/agent.test.ts checks that every path in docs/interfaces/api.openapi.yaml is listed here.
export interface Endpoint { path: string; what: string }

export const API_ENDPOINTS: Endpoint[] = [
  { path: '/api/health', what: 'Indexer freshness: status ok, stale or fixture, lag in blocks, last error.' },
  { path: '/api/launches', what: 'The launch feed, with tab, launch_type, q, creator and sort filters.' },
  { path: '/api/launch/{id}', what: 'One launch: Charter hash, verdict inputs, margin, allocation, timeline.' },
  { path: '/api/token/{id}', what: 'Token page data: pool, safety indicators, genesis progress, external pools.' },
  { path: '/api/token/{id}/candles', what: 'OHLCV candles for the pool.' },
  { path: '/api/token/{id}/trades', what: 'Trades from market swap events, newest first.' },
  { path: '/api/token/{id}/holders', what: 'Holders as folded from claims and swaps.' },
  { path: '/api/token/{id}/depth', what: 'Pool reserves and a price-impact ladder.' },
  { path: '/api/creator/{account}', what: 'Creator desk: launches, earnings, claims, stream meter.' },
  { path: '/api/export/creator/{account}/claims.csv', what: 'Creator claims and stream draws as CSV.' },
  { path: '/api/portfolio/{account}', what: 'Positions, funds in motion and market balances for one account.' },
  { path: '/api/verify/{id}', what: 'Hashes, the folded book check and event references for recomputing a verdict.' },
  { path: '/api/stats', what: 'Aggregates folded from indexed events only. Each figure says what it counts.' },
  { path: '/api/ops-log', what: 'Pause, freeze, cap and similar events the contracts logged, newest first.' },
  { path: '/api/ops/status', what: 'Which operator powers have been seen in use: pause, freeze, halt, upgrade queue, solvency, with the last event of each.' },
  { path: '/api/ops/upgrades', what: 'Queued, cancelled and executed core upgrades with the 7-day delay.' },
  { path: '/api/ops/halts', what: 'Per-launch halts and resumes. A halt never blocks Walk, refunds or the verdict.' },
  { path: '/api/ops/force-resolves', what: 'Queued and executed force-resolves of stuck payout legs (48 hour delay).' },
  { path: '/api/ops/solvency', what: 'Solvency reports and the Intents-balance alert state. Informational.' },
  { path: '/api/ops/owed', what: 'NEAR and token amounts owed to accounts after a failed outbound transfer.' },
  { path: '/api/launch/{id}/custody', what: 'Token custody for one launch: claimed, swept, creator allocation, burn mode.' },
  { path: '/api/launch/{id}/genesis', what: 'Solana genesis state for one launch: status, F0 gate slots, reopen count, attestations.' },
  { path: '/api/export/launches.csv', what: 'Open launch dataset as CSV.' },
  { path: '/api/export/trades.csv', what: 'Open trades dataset as CSV.' },
  { path: '/api/stream', what: 'Server-sent events: trade, candle and launch updates.' },
];

const RULES = [
  'Read only. There are no write methods, no API keys and no login. Nothing here signs, sends or holds funds.',
  'Nothing in the API is authoritative. Every number is a fold of contract events. The contracts decide; recompute a verdict with scripts/verify.sh or on /launch/{id}/verify.',
  'Amounts are decimal strings in base units (USDC has 6 decimals). Times are unix seconds.',
  'Every object carries source: "chain" or "fixture". Fixture numbers come from an offline generator and must be shown as fixture data.',
  'Every response carries as_of, the last indexed block. The data can be behind or down while the contracts keep working.',
  'This is a testnet and devnet rehearsal. There is no independent audit. Unproven paths are labelled UNPROVEN.',
];

const PAGES: [string, string][] = [
  ['/docs/how-it-works', 'The lifecycle in plain language'], ['/docs/security', 'Who holds which key, what is bounded, and the attack gallery'],
  ['/docs/verify', 'Recompute a verdict yourself'], ['/docs/fees', 'Every fee'], ['/ops-log', 'Operator powers and what the contracts logged'],
  ['/charter', 'Disclosures'], ['/legal/risk', 'Risk disclosure (draft)'],
];

export function llmsTxt(apiBase: string, siteBase = ''): string {
  return [
    '# Kruxa',
    '',
    '> Kruxa is a token launch interface where a launch is a refundable trial first. During the trial buyers can Walk and get their principal back (less any relay fee and, for Solana, the Intents withdrawal fee); the verdict is three public numbers anyone can recompute. Instant launches have no trial, no verdict and no refund. Testnet and devnet rehearsal, no independent audit.',
    '',
    '## Rules for agents',
    ...RULES.map((r) => `- ${r}`),
    '',
    '## Read-only API',
    `Base URL: ${apiBase}`,
    `- [OpenAPI description](${siteBase}/openapi.yaml): the full schema`,
    ...API_ENDPOINTS.map((e) => `- ${e.path}: ${e.what}`),
    '',
    '## Pages',
    ...PAGES.map(([p, d]) => `- [${p}](${siteBase}${p}): ${d}`),
    `- [AGENTS.md](${siteBase}/AGENTS.md): the same rules for coding agents`,
    '',
  ].join('\n');
}

export function agentsMd(apiBase: string): string {
  return [
    '# AGENTS.md for the Kruxa web app',
    '',
    'This file describes what an automated agent may read here. It is the public, read-only layer. It is not the repository instruction file.',
    '',
    '## What you may do',
    ...RULES.map((r) => `- ${r}`),
    '',
    '## Where to read',
    `- API base: ${apiBase}`,
    '- Schema: /openapi.yaml',
    '- Index for language models: /llms.txt',
    '- Human docs: /docs',
    ...API_ENDPOINTS.map((e) => `- ${e.path}: ${e.what}`),
    '',
    '## What you must not claim',
    '- Do not call Kruxa audited, reviewed, trustless, immutable or safe. There is a phase-0 upgrade key with a 7 day public timelock, a token factory whose owner can replace token code, and no independent audit.',
    '- Do not describe a PASS verdict as a statement about value. It says a rule was met.',
    '- Do not describe yield, returns, revenue or sybil resistance. None is claimed.',
    '- Instant launches are not trial-verified. Never present one as such.',
    '',
    '## Source of truth',
    '- The contracts decide verdicts, refunds and payouts. The API and this site are views of public events.',
    '- Operator powers and their limits are listed at /ops-log.',
    '',
  ].join('\n');
}
