import { agentsMd } from '@/content/agent';
import { CONFIG } from '@/lib/config';

export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(agentsMd(CONFIG.api), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
