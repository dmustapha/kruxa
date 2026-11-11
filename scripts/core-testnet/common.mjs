// Shared setup for the core3 testnet scripts. TESTNET ONLY: refuses any root that is not a .testnet account and
// any RPC that looks like mainnet. Keys are read by scripts/instant-testnet/lib.mjs from ~/.kruxa-secrets (mode 600)
// and are never printed. Evidence goes to evidence/testnet-core3/ (txlog.jsonl is appended by lib.mjs).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.KXI_ROOT = process.env.KXI_ROOT || 'kxi-root-1108.testnet';
process.env.KXI_EVID = process.env.KXI_EVID || path.resolve(here, '../../evidence/testnet-core3');
if (!process.env.KXI_ROOT.endsWith('.testnet')) throw new Error('refusing: testnet only');
if (/mainnet|near\.org\/?$|rpc\.mainnet/i.test(process.env.KXI_RPC || '')) throw new Error('refusing: mainnet RPC');

export const L = await import('../instant-testnet/lib.mjs');
export const ROOT = L.ROOT;
export const EVID = L.EVID;
export const REPO = path.resolve(here, '../..');

// Account ids of the core3 stack. Existing mocks are reused where the task says so; nothing existing is overwritten.
export const A = {
  owner: ROOT,
  core: process.env.KXI_CORE || `core3.${ROOT}`, // KXI_CORE names a fresh core account (e.g. core4.<root>); default stays core3
  market: process.env.KXI_MARKET || `market3.${ROOT}`, // KXI_MARKET names a fresh market for a fresh core (e.g. market4.<root>)
  usdc: `usdc.${ROOT}`,
  guardian: `guardian.${ROOT}`,
  treasury: `treasury.${ROOT}`,
  relayFees: `relay-fees.${ROOT}`,
  intents: 'intents.kxa1-owner-1203.testnet', // reused mock Intents (accepts fake signatures; any token id)
  factory: 'factory.kxi-root-0811.testnet', // reused mock factory (creates nothing; launch tokens are pre-made mock FTs under it)
  genesisRelayer: '7218da57019c05386280b3a4196e7654279e32c66e129889e17a653fc229cc85',
};
for (const v of Object.values(A)) if (!/^[a-z0-9._-]+$/.test(v)) throw new Error('bad account id');

export const wasmPath = (name) => path.join(REPO, 'artifacts', `${name}.wasm`);
export async function sha256Hex(buf) {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(buf).digest('hex');
}
/** sha256 of the code actually deployed on `account` (RPC view_code). */
export async function onChainSha(account) {
  const r = await (await L.net()).connection.provider.query({ request_type: 'view_code', finality: 'optimistic', account_id: account });
  return sha256Hex(Buffer.from(r.code_base64, 'base64'));
}
export function writeJson(name, obj) {
  fs.mkdirSync(EVID, { recursive: true });
  fs.writeFileSync(path.join(EVID, name), JSON.stringify(obj, null, 2) + '\n');
}
export function readJson(name, dflt = {}) {
  const p = path.join(EVID, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : dflt;
}
export const ONE_NEAR = 10n ** 24n;
