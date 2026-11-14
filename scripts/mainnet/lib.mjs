// Shared guard rails for the NEAR MAINNET scripts in this folder. Every script DEFAULTS TO DRY-RUN.
//
// A transaction is sent only when BOTH hold:
//   1. env KRUXA_MAINNET_CONFIRMED=I_CONFIRM_DAMI_RUNS_THIS
//   2. the operator types back `SEND <code>` for the exact summary the script printed (the code is a hash of that summary).
// One script run = one transaction = one confirmation. Keys come from a file named in env KRUXA_KEY_FILE (mode 600, never printed,
// never in the repo). The RPC must look like mainnet AND answer `status` with chain_id "mainnet" (send mode refuses on anything else).
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline/promises';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

export const CONFIRM_ENV = 'KRUXA_MAINNET_CONFIRMED';
export const CONFIRM_VALUE = 'I_CONFIRM_DAMI_RUNS_THIS';
export const DEFAULT_RPC = 'https://rpc.mainnet.near.org';
export const ONE_NEAR = 10n ** 24n;
export const TGAS = 10n ** 12n;
// Gas is charged at the block gas price; mainnet floor is 1e-4 NEAR per Tgas. The cost estimate assumes 3x that, to stay conservative.
const GAS_NEAR_PER_TGAS_PESSIMISTIC = 3n * 10n ** 20n;
export const STORAGE_YOCTO_PER_BYTE = 10n ** 19n; // 1e-5 NEAR per byte
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../..');
const NOT_MAINNET_URL = /test|dev|local|sandbox|beta|127\.|0\.0\.0\.0/i;

export class Refusal extends Error {}

export const nearToYocto = (s) => {
  const m = /^(\d+)(?:\.(\d{1,24}))?$/.exec(String(s).trim());
  if (!m) throw new Refusal(`not a NEAR amount: ${s}`);
  return BigInt(m[1]) * ONE_NEAR + BigInt((m[2] || '').padEnd(24, '0'));
};
export const yoctoToNear = (y) => {
  const v = BigInt(y), whole = v / ONE_NEAR, frac = (v % ONE_NEAR).toString().padStart(24, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac.slice(0, 8)}` : `${whole}`;
};
export const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function makeCtx(over = {}) {
  return {
    env: process.env,
    fetch: globalThis.fetch,
    out: (s) => console.log(s),
    ask: async (q) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); try { return await rl.question(q); } finally { rl.close(); } },
    sendTx: sendWithNearApiJs,
    ...over,
  };
}

export function need(ctx, name) {
  const v = ctx.env[name];
  if (!v || /REPLACE_ME/.test(v)) throw new Refusal(`env ${name} is not set (see scripts/mainnet/values.example.env)`);
  return v;
}
export function accountId(ctx, name) {
  const v = need(ctx, name);
  if (!/^[a-z0-9._-]{2,64}$/.test(v)) throw new Refusal(`env ${name} is not a valid NEAR account id`);
  return v;
}

export function rpcUrl(ctx) {
  const url = ctx.env.KRUXA_NEAR_RPC || DEFAULT_RPC;
  if (NOT_MAINNET_URL.test(url)) throw new Refusal(`refusing RPC ${url}: it looks like a test, dev, local or beta endpoint. Mainnet only.`);
  return url;
}

export async function rpc(ctx, method, params) {
  const res = await ctx.fetch(rpcUrl(ctx), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'kruxa', method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(`rpc ${method}: ${JSON.stringify(j.error.data || j.error.message || j.error).slice(0, 200)}`);
  if (j.result && j.result.error) throw new Error(`rpc ${method}: ${String(j.result.error).slice(0, 200)}`);
  return j.result;
}
export const query = (ctx, request) => rpc(ctx, 'query', { finality: 'final', ...request });
export const viewAccount = (ctx, account_id) => query(ctx, { request_type: 'view_account', account_id });
export async function accountExists(ctx, id) {
  try { await viewAccount(ctx, id); return true; } catch (e) { if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(e.message))) return false; throw e; }
}
export async function view(ctx, contract, method, args = {}) {
  const r = await query(ctx, { request_type: 'call_function', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  const text = Buffer.from(r.result).toString('utf8');
  return text ? JSON.parse(text) : null;
}
export async function onChainSha(ctx, account_id) {
  const r = await query(ctx, { request_type: 'view_code', account_id });
  return sha256Hex(Buffer.from(r.code_base64, 'base64'));
}

/** Network line every script prints first. In send mode the chain id MUST be mainnet; in dry-run an unreachable RPC is reported, not fatal. */
export async function networkLine(ctx, sending) {
  const url = rpcUrl(ctx);
  let chain = null;
  try { chain = (await rpc(ctx, 'status', [])).chain_id; } catch (e) { if (sending) throw new Refusal(`cannot verify the network: ${e.message}`); }
  if (chain && chain !== 'mainnet') throw new Refusal(`refusing: RPC ${url} reports chain_id "${chain}", not "mainnet"`);
  const line = chain ? `NETWORK: NEAR MAINNET (chain_id mainnet) via ${url}` : `NETWORK: NEAR MAINNET (unverified, RPC unreachable in dry-run) via ${url}`;
  ctx.out(line);
  return { url, verified: Boolean(chain) };
}

export function wasmSumFor(name, dir = path.join(REPO, 'artifacts')) {
  const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8').split('\n');
  const row = sums.map((l) => l.trim().split(/\s+/)).find((p) => p.length === 2 && path.basename(p[1]) === `${name}.wasm`);
  if (!row) throw new Refusal(`artifacts/SHA256SUMS has no line for ${name}.wasm`);
  return row[0];
}
export function readWasm(name, dir = path.join(REPO, 'artifacts')) {
  const file = path.join(dir, `${name}.wasm`);
  const bytes = fs.readFileSync(file);
  const sha = sha256Hex(bytes);
  const want = wasmSumFor(name, dir);
  if (sha !== want) throw new Refusal(`ABORT: ${file} hashes to ${sha} but SHA256SUMS says ${want}`);
  return { file, bytes, sha256: sha };
}

// ---- plan, summary, cost -------------------------------------------------------------------------------------------------------------
/** plan = { signer, receiver, actions: [...], capNear, lockedNear?, notes?: [] }. Action kinds: DeployContract, FunctionCall, CreateAccount, Transfer, AddKey. */
export function costYocto(plan) {
  let deposits = 0n, gas = 0n;
  for (const a of plan.actions) {
    if (a.kind === 'FunctionCall') { deposits += BigInt(a.depositYocto); gas += BigInt(a.gasTgas) * GAS_NEAR_PER_TGAS_PESSIMISTIC; }
    if (a.kind === 'Transfer') deposits += BigInt(a.yocto);
    if (a.kind === 'DeployContract') gas += 100n * GAS_NEAR_PER_TGAS_PESSIMISTIC; // deploy bytes are metered per byte; 100 Tgas covers 655 KB with room
    if (a.kind === 'CreateAccount' || a.kind === 'AddKey') gas += 10n * GAS_NEAR_PER_TGAS_PESSIMISTIC;
  }
  return { deposits, gas, total: deposits + gas };
}
const printable = (a) => (a.kind === 'DeployContract' ? { kind: a.kind, bytes: a.bytes.length, sha256: a.sha256 } : a.kind === 'FunctionCall' ? { ...a, depositNear: yoctoToNear(a.depositYocto) } : a);
export function summarize(plan) {
  const c = costYocto(plan);
  const body = { signer: plan.signer, receiver: plan.receiver, actions: plan.actions.map(printable) };
  const code = sha256Hex(JSON.stringify(body)).slice(0, 8);
  const lines = ['---- TRANSACTION SUMMARY (NEAR MAINNET, REAL MONEY) ----', `signer:   ${plan.signer}`, `receiver: ${plan.receiver}`];
  for (const a of body.actions) lines.push(`action:   ${JSON.stringify(a)}`);
  lines.push(`spend (deposits + gas at 3x floor price): ${yoctoToNear(c.total)} NEAR  (deposits ${yoctoToNear(c.deposits)}, gas ${yoctoToNear(c.gas)}); cap ${plan.capNear} NEAR`);
  if (plan.lockedNear) lines.push(`locked as storage stake (not spent, stays on the account): ${plan.lockedNear} NEAR`);
  for (const n of plan.notes || []) lines.push(`note:     ${n}`);
  lines.push(`confirmation code: SEND ${code}`, '--------------------------------------------------------');
  return { text: lines.join('\n'), code, cost: c };
}

/** The typed half of the gate: throws unless the operator types exactly `SEND <code>`. Shared with the Solana script. */
export async function typedConfirmation(ctx, code) {
  const typed = (await ctx.ask(`Type "SEND ${code}" to send exactly the transaction above, anything else aborts: `)).trim();
  if (typed !== `SEND ${code}`) throw new Refusal('ABORTED: confirmation text did not match; nothing was sent');
}
export const isSending = (ctx) => ctx.env[CONFIRM_ENV] === CONFIRM_VALUE;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Base58 string (a Solana public key) to 64 hex characters; throws unless it decodes to exactly 32 bytes. */
export function base58ToHex32(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Refusal(`not base58: ${s}`); n = n * 58n + BigInt(i); }
  const hex = n.toString(16).padStart(64, '0');
  if (hex.length !== 64) throw new Refusal(`${s} does not decode to 32 bytes`);
  return hex;
}

/** Prints the summary, enforces the cost cap, then either stops (dry-run) or sends after the typed confirmation. Returns { sent, txHash? }. */
export async function execute(ctx, plan) {
  const sending = isSending(ctx);
  const net = await networkLine(ctx, sending);
  const s = summarize(plan);
  ctx.out(s.text);
  if (s.cost.total > nearToYocto(plan.capNear)) throw new Refusal(`REFUSING: estimated spend ${yoctoToNear(s.cost.total)} NEAR exceeds this script's cap of ${plan.capNear} NEAR`);
  if (plan.blockers && plan.blockers.length) throw new Refusal(`REFUSING: ${plan.blockers.join('; ')}`);
  if (!sending) { ctx.out(`DRY RUN: nothing was sent. To send: export ${CONFIRM_ENV}=${CONFIRM_VALUE} and re-run, then type the confirmation code.`); return { sent: false }; }
  if (!net.verified) throw new Refusal('refusing to send: network not verified');
  await typedConfirmation(ctx, s.code);
  const txHash = await ctx.sendTx(ctx, plan, net);
  ctx.out(`SENT tx=${txHash}`);
  return { sent: true, txHash };
}

// ---- keys and sending ----------------------------------------------------------------------------------------------------------------
/** Reads the private key from the file in env KRUXA_KEY_FILE. Refuses a group/world readable file or one inside the repo. The key is never printed. */
export function readKeyFile(ctx) {
  const file = need(ctx, 'KRUXA_KEY_FILE');
  const abs = path.resolve(file.replace(/^~/, os.homedir()));
  if (abs.startsWith(REPO + path.sep)) throw new Refusal('KRUXA_KEY_FILE must live outside the repo');
  if ((fs.statSync(abs).mode & 0o077) !== 0) throw new Refusal(`KRUXA_KEY_FILE ${abs} must be mode 600 (chmod 600)`);
  const j = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const secret = j.private_key || j.secret_key;
  if (!secret || !/^ed25519:/.test(secret)) throw new Refusal('KRUXA_KEY_FILE must be JSON with an "ed25519:..." private_key (near-cli credentials format)');
  return { secret, accountId: j.account_id };
}

async function loadNear() {
  try { return await import('near-api-js'); } catch { return createRequire(path.join(REPO, 'scripts/instant-testnet/'))('near-api-js'); }
}

async function toActions(nearLib, plan) {
  const t = nearLib.transactions;
  return plan.actions.map((a) => {
    if (a.kind === 'DeployContract') return t.deployContract(a.bytes);
    if (a.kind === 'FunctionCall') return t.functionCall(a.method, a.args, BigInt(a.gasTgas) * TGAS, BigInt(a.depositYocto));
    if (a.kind === 'CreateAccount') return t.createAccount();
    if (a.kind === 'Transfer') return t.transfer(BigInt(a.yocto));
    if (a.kind === 'AddKey') return t.addKey(nearLib.utils.PublicKey.from(a.publicKey), t.fullAccessKey());
    throw new Refusal(`unknown action ${a.kind}`);
  });
}

/** Default sender: near-api-js, ONE signed transaction with all of plan.actions (so a deploy plus `new` is atomic). */
export async function sendWithNearApiJs(ctx, plan, net) {
  const nearLib = await loadNear();
  const key = readKeyFile(ctx);
  if (key.accountId && key.accountId !== plan.signer) throw new Refusal(`key file belongs to ${key.accountId}, but this transaction is signed by ${plan.signer}`);
  const pair = nearLib.KeyPair.fromString(key.secret);
  const onChain = await query(ctx, { request_type: 'view_access_key', account_id: plan.signer, public_key: pair.getPublicKey().toString() }).catch(() => null);
  if (!onChain) throw new Refusal(`the key in KRUXA_KEY_FILE is not an access key of ${plan.signer} on mainnet`);
  const keyStore = new nearLib.keyStores.InMemoryKeyStore();
  await keyStore.setKey('mainnet', plan.signer, pair);
  const near = await nearLib.connect({ networkId: 'mainnet', nodeUrl: net.url, keyStore });
  const out = await (await near.account(plan.signer)).signAndSendTransaction({ receiverId: plan.receiver, actions: await toActions(nearLib, plan) });
  const failed = out.status && out.status.Failure;
  if (failed) throw new Error(`transaction ${out.transaction.hash} failed: ${JSON.stringify(failed).slice(0, 300)}`);
  return out.transaction.hash;
}

/** Wraps a script's main(): prints refusals without a stack trace and exits non-zero. */
export function runMain(main) {
  main(makeCtx(), process.argv.slice(2)).then(
    () => process.exit(0),
    (e) => { console.error(e instanceof Refusal ? String(e.message) : `FAILED: ${e && e.message ? e.message : e}`); process.exit(e instanceof Refusal ? 2 : 1); },
  );
}
export const isEntry = (metaUrl) => process.argv[1] && fileURLToPath(metaUrl) === path.resolve(process.argv[1]);

// ---- deploy helpers ------------------------------------------------------------------------------------------------------------------
const EMPTY_CODE_HASH = '11111111111111111111111111111111';
/** Shared by deploy-core and deploy-market: wasm hash must equal artifacts/SHA256SUMS, the account must be empty, and must hold the storage stake. */
export async function deployPreflight(ctx, account, wasm) {
  const acc = await viewAccount(ctx, account).catch((e) => { throw new Refusal(`account ${account} is not readable on mainnet: ${e.message}`); });
  if (acc.code_hash !== EMPTY_CODE_HASH) throw new Refusal(`ABORT: ${account} already has code (code_hash ${acc.code_hash}). This script only deploys onto an empty account.`);
  const lock = BigInt(wasm.bytes.length) * STORAGE_YOCTO_PER_BYTE + BigInt(acc.storage_usage) * STORAGE_YOCTO_PER_BYTE;
  const margin = nearToYocto('0.05');
  const blockers = BigInt(acc.amount) < lock + margin ? [`${account} holds ${yoctoToNear(acc.amount)} NEAR but needs at least ${yoctoToNear(lock + margin)} NEAR (storage stake ${yoctoToNear(lock)} + 0.05): fund it first`] : [];
  return { lock, blockers };
}
/** After the send: the code on chain must hash to the same value as the wasm in artifacts/. Throws loudly otherwise. */
export async function verifyDeployed(ctx, account, wasm) {
  const got = await onChainSha(ctx, account);
  ctx.out(`view_code sha256 ${got}\nartifacts sha256 ${wasm.sha256}\n${got === wasm.sha256 ? 'CODE MATCH' : 'CODE MISMATCH'}`);
  if (got !== wasm.sha256) throw new Error(`MISMATCH: on-chain code ${got} differs from artifacts ${wasm.sha256}. Treat the deployment as untrusted: stop and tell the owner.`);
}
