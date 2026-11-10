import type { Page } from '../../types';
import { code, h2, note, p, table, ul } from '../../blocks';
import { API_ENDPOINTS } from '../../agent';

export const api: Page = {
  slug: 'api',
  title: 'Read-only API',
  group: 'Reference',
  summary: 'The indexer API, its OpenAPI file, llms.txt and AGENTS.md. Read only, no keys.',
  blocks: [
    note('info', 'Nothing here signs, sends or holds funds, and nothing in the API is authoritative. The contracts decide. Every number is a fold of contract events that you can rebuild.', 'Read only'),
    h2('Where to find it'),
    ul(
      '[OpenAPI description](/openapi.yaml): the full schema, version 1.2.0.',
      '[llms.txt](/llms.txt): an index for language models, with the same rules as this page.',
      '[AGENTS.md](/AGENTS.md): what an automated agent may read and what it must not claim.',
    ),
    p('The API is served by the indexer, not by this website. Its address is set at build time. In a local run it is `http://localhost:8787`.'),
    h2('Conventions'),
    ul(
      'No authentication, no write methods, no keys.',
      'Amounts are decimal strings of integers in base units. USDC and launch tokens both have 6 decimals.',
      'Times are unix seconds.',
      'Every object that carries numbers has `source`: `chain` when every contributing event came from a NEAR block, `fixture` when any came from the offline generator. Fixture numbers are always shown as fixture data.',
      'Every response carries `as_of`, the last indexed block, so staleness is visible.',
      'Errors are `{ "error": { "code": "...", "message": "..." } }` with HTTP 400, 404 or 503.',
    ),
    h2('Endpoints'),
    table(['Path', 'What it returns'], ...API_ENDPOINTS.map((e) => [`\`${e.path}\``, e.what])),
    h2('Try it'),
    code(`curl -s http://localhost:8787/api/health
curl -s "http://localhost:8787/api/launches?tab=live&limit=5"
curl -s http://localhost:8787/api/launch/1
curl -s http://localhost:8787/api/ops-log`),
    h2('When the indexer is down'),
    p('The app reads the NEAR RPC directly where it can. If the indexer cannot be reached and a recorded snapshot was deployed with the site, the feed, launch pages and token pages show the snapshot, labelled RECORDED with its time. A snapshot is never presented as live, and anything without a snapshot shows an error instead of a guess.'),
    p('Operator powers and their limits are listed on the [operations log](/ops-log).'),
  ],
};
