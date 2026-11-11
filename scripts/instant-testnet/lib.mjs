// Shared helpers for the instant-launcher testnet run. TESTNET ONLY (refuses anything else). Keys are read from
// ~/.kruxa-secrets/instant-testnet/<account>.json (mode 600) and are never printed or written elsewhere.
import fs from 'fs';
import path from 'path';
import { connect, KeyPair, keyStores, utils } from 'near-api-js';

export const ROOT = process.env.KXI_ROOT || 'kxi-root-0811.testnet';
if (!ROOT.endsWith('.testnet')) throw new Error('refusing: testnet only');
const SECRETS = path.join(process.env.HOME, '.kruxa-secrets', 'instant-testnet');
export const EVID = process.env.KXI_EVID || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../evidence/instant-testnet');
export const RPC = process.env.KXI_RPC || 'https://test.rpc.fastnear.com';
export const USDC = 1_000_000n;
export const N_TOTAL = 1_000_000_000_000_000n;
export const id = (n) => `${n}.${ROOT}`;
export const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

const keyStore = new keyStores.InMemoryKeyStore();
export function keyFile(name) { return path.join(SECRETS, `${name}.json`); }
export async function loadKey(name) {
  const f = keyFile(name);
  if (!fs.existsSync(f)) return false;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  await keyStore.setKey('testnet', name, KeyPair.fromString(j.private_key));
  return true;
}
export function newKey(name) {
  const kp = KeyPair.fromRandom('ed25519');
  fs.writeFileSync(keyFile(name), JSON.stringify({ account_id: name, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
  return kp;
}
// The shared fastnear endpoint answers HTTP 429 when another client is busy: wait and resend (a 429 means the request was not processed).
function retryOnRateLimit(provider) {
  const send = provider.sendJsonRpc.bind(provider);
  provider.sendJsonRpc = async (method, params) => {
    for (let i = 0; ; i++) {
      try { return await send(method, params); } catch (e) {
        if (i >= 8 || !/-429|Rate limits exceeded|fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR/.test(String(e && e.message))) throw e;
        await sleep(5 * (i + 1));
      }
    }
  };
}
let near;
export async function net() {
  if (!near) { near = await connect({ networkId: 'testnet', nodeUrl: RPC, keyStore }); retryOnRateLimit(near.connection.provider); }
  return near;
}
export async function acct(name) {
  await loadKey(name);
  return (await net()).account(name);
}
export async function exists(name) {
  try { await (await net()).connection.provider.query({ request_type: 'view_account', finality: 'optimistic', account_id: name }); return true; } catch { return false; }
}
export async function balanceNear(name) {
  const r = await (await net()).connection.provider.query({ request_type: 'view_account', finality: 'optimistic', account_id: name });
  return Number(BigInt(r.amount) / 10n ** 18n) / 1e6;
}
export async function view(contract, method, args = {}) {
  const a = await acct(ROOT);
  return a.viewFunction({ contractId: contract, methodName: method, args, blockQuery: { finality: 'optimistic' } });
}

function ruleCodes(text) {
  return [...new Set((text.match(/(?<![A-Za-z0-9_])R_[A-Z_]+|STREAM_CAP/g) || []).map((c) => c.replace(/_$/, '')))];
}
function collect(out) {
  const logs = (out.receipts_outcome || []).flatMap((r) => r.outcome.logs || []);
  const fails = (out.receipts_outcome || []).map((r) => r.outcome.status).filter((s) => s && s.Failure).map((s) => JSON.stringify(s.Failure));
  const top = out.status && out.status.Failure ? JSON.stringify(out.status.Failure) : '';
  const burnt = (out.receipts_outcome || []).reduce((s, r) => s + BigInt(r.outcome.tokens_burnt), BigInt(out.transaction_outcome.outcome.tokens_burnt));
  const value = out.status && out.status.SuccessValue ? Buffer.from(out.status.SuccessValue, 'base64').toString() : null;
  return { logs, fails: [top, ...fails].filter(Boolean), codes: ruleCodes(logs.join('\n') + fails.join('\n') + top), burnt_near: Number(burnt / 10n ** 18n) / 1e6, value };
}
export function append(file, rec) {
  fs.mkdirSync(EVID, { recursive: true });
  fs.appendFileSync(path.join(EVID, file), JSON.stringify(rec) + '\n');
}
/** One signed function call. Records the tx hash, rule codes seen, and success. `step` is a human label. */
export async function call(step, signer, contract, method, args = {}, { gas = '300000000000000', deposit = '0', expectFail = false } = {}) {
  const a = await acct(signer);
  let out, err = null;
  try {
    out = await a.functionCall({ contractId: contract, methodName: method, args, gas: BigInt(gas), attachedDeposit: BigInt(deposit) });
  } catch (e) {
    err = e;
    out = e.context && e.context.transactionHash ? null : null;
  }
  let rec;
  if (out) {
    const c = collect(out);
    rec = { step, signer, contract, method, tx: out.transaction.hash, success: !(out.status && out.status.Failure) && c.fails.length === 0, rule_codes: c.codes, value: c.value && c.value.length < 200 ? c.value : undefined, gas_burnt_near: c.burnt_near, log_lines: c.logs.filter((l) => !l.startsWith('EVENT_JSON')).slice(0, 6), receipts: (out.receipts_outcome || []).map((r) => `${r.outcome.executor_id.split('.')[0]}:${r.outcome.status.Failure ? 'FAIL' : 'ok'}`).join(' '), failures: c.fails.map((f) => f.slice(0, 200)).slice(0, 2) };
  } else {
    const msg = String(err && err.message || err);
    rec = { step, signer, contract, method, tx: (err && err.transaction_outcome && err.transaction_outcome.id) || (err && err.context && err.context.transactionHash) || null, success: false, rule_codes: ruleCodes(msg), error: msg.slice(0, 300) };
  }
  rec.expected = expectFail ? 'refused' : 'ok';
  rec.at = new Date().toISOString();
  append('txlog.jsonl', rec);
  console.log(`${rec.success ? 'OK  ' : 'FAIL'} ${step} tx=${rec.tx} codes=${rec.rule_codes.join(',')}`);
  return rec;
}
export async function snapshot(label, launcher, market, launchId) {
  const s = { label, at: new Date().toISOString(), launcher: await view(launcher, 'get_invariants', {}) };
  if (launchId) { s.launch = await view(launcher, 'get_invariants', { launch_id: launchId }); s.instant = await view(launcher, 'get_instant', { launch_id: launchId }); }
  if (market) {
    s.market = await view(market, 'get_invariants', {});
    if (launchId) { const p = await view(market, 'get_pool', { launch_id: launchId }); if (p) { s.pool = p; s.pool_invariants = await view(market, 'pool_invariants', { launch_id: launchId }); } }
  }
  append('snapshots.jsonl', s);
  const bad = Object.entries({ ...s.launcher, ...(s.launch || {}), ...(s.market || {}), ...(s.pool_invariants || {}) }).filter(([k, v]) => v === false && !k.includes('paused'));
  console.log(`SNAP ${label}${bad.length ? ' FALSE: ' + bad.map(([k]) => k).join(',') : ' (all identities true)'}`);
  return s;
}
/** Creates `name` (a subaccount of `parent`) with `fundNear` NEAR and a fresh key. */
export async function ensureAccount(name, parent, fundNear) {
  if (await exists(name)) { await loadKey(name); return; }
  const kp = newKey(name);
  const p = await acct(parent);
  const out = await p.createAccount(name, kp.getPublicKey(), utils.format.parseNearAmount(String(fundNear)));
  append('txlog.jsonl', { step: `create account ${name} (${fundNear} NEAR)`, signer: parent, contract: name, method: 'create_account', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
  console.log(`created ${name} tx=${out.transaction.hash}`);
  await loadKey(name);
}
export async function deployWasm(name, wasmPath, initMethod, initArgs) {
  const q = await (await net()).connection.provider.query({ request_type: 'view_account', finality: 'optimistic', account_id: name });
  if (q.code_hash !== '11111111111111111111111111111111') { console.log('already deployed', name); return; }
  const a = await acct(name);
  const bytes = fs.readFileSync(wasmPath);
  const out = await a.deployContract(bytes);
  append('txlog.jsonl', { step: `deploy ${path.basename(wasmPath)} to ${name}`, signer: name, contract: name, method: 'DeployContract', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
  console.log(`deployed ${wasmPath} -> ${name} tx=${out.transaction.hash}`);
  if (initMethod) await call(`init ${name}.${initMethod}`, name, name, initMethod, initArgs, { gas: '100000000000000' });
}
export const tgas = (n) => String(BigInt(n) * 10n ** 12n);
export const yocto = (n) => utils.format.parseNearAmount(String(n));

export async function balanceRawNear(name) {
  const r = await (await net()).connection.provider.query({ request_type: 'view_account', finality: 'optimistic', account_id: name });
  return Number(BigInt(r.amount)) / 1e24;
}
