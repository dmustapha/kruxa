// Seeds launches on core3 (NEAR TESTNET, play money): creates the launch token (mock FT under the reused mock factory), creates the trial,
// funds buyers through the mock Intents (Solana-delivered) and/or the mock USDC (native), commits them, and waits for the phase Ready.
// Settlement is NOT done here: scripts/keeper.sh does it (settle, pages, sweep, consolidate, fees), so the keeper log is real evidence.
//   node seed.mjs A|B|C|D|E|F    A = PASS (F0 plan), B = FAIL (too few funders), C = PASS + market (F1 plan), D/E = F0 rehearsals, F = F1 rehearsal
// Testnet only. Holder secret keys go to ~/.kruxa-secrets/genesis/holders-<id>.json (mode 600), never into evidence.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { L, A, REPO, ONE_NEAR, wasmPath, writeJson, readJson } from './common.mjs';

const USDC_ = 1_000_000n;
const RESERVE_NEAR = 2;
const SQUADS = 'CneX72zHFJsd71BBZ39xAuBH8zBySsWo6RedYr6j6A1Z'; // devnet Squads vault of the earlier genesis rehearsals
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const SPECS = {
  A: { sym: 'KXCA', mode: 'F0', creator: 'creator-a', buyers: 12, amount: 30n, note: 'PASS, F0 genesis' },
  B: { sym: 'KXCB', mode: 'F1', creator: 'creator-b', buyers: 5, amount: 30n, note: 'FAIL (5 funders, under the 10 minimum and the soft cap)' },
  C: { sym: 'KXCC', mode: 'F1', creator: 'creator-a', buyers: 11, natives: ['buyer'], amount: 30n, note: 'PASS, F1 genesis, open and trading on the market' },
  D: { sym: 'KXCD', mode: 'F0', creator: 'creator-b', buyers: 12, amount: 30n, note: 'F0 rehearsal 2' },
  E: { sym: 'KXCE', mode: 'F0', creator: 'creator-a', buyers: 12, amount: 30n, note: 'F0 rehearsal 3' },
  F: { sym: 'KXCF', mode: 'F1', creator: 'creator-b', buyers: 12, amount: 30n, note: 'F1 rehearsal (sweep fix, verify C16)' },
};

const b58 = (buf) => {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex')); let s = '';
  while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
};
const b58decode32 = (s) => { let n = 0n; for (const c of s) n = n * 58n + BigInt(ALPHA.indexOf(c)); return n.toString(16).padStart(64, '0'); };
function newSolKey() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  const seed = Buffer.from(jwk.d, 'base64url'), pub = Buffer.from(jwk.x, 'base64url');
  return { secret64: [...seed, ...pub], pub };
}
async function rootGuard(spend) {
  const bal = await L.balanceRawNear(A.owner);
  if (bal - spend < RESERVE_NEAR) throw new Error(`root ${bal.toFixed(3)} NEAR minus ${spend} would go below the ${RESERVE_NEAR} NEAR reserve: stopping`);
}
async function nextLaunchId() {
  let id = 1;
  while ((await L.view(A.core, 'get_state', { launch_id: String(id) })) !== null) id++;
  return id;
}

/** The launch token: a mock FT at <symbol>.<factory> holding the whole supply at the core. Created by the factory account (reused mock factory). */
async function ensureToken(sym) {
  const token = `${sym.toLowerCase()}.${A.factory}`;
  if (await L.exists(token)) {
    let ok = true;
    try { await L.view(token, 'ft_total_supply', {}); } catch { ok = false; }
    if (!ok) { // deployed but never initialised (an earlier run ran out of storage balance for `new`): top up from the factory and init
      const fac = await L.acct(A.factory);
      const out = await fac.sendMoney(token, 100n * 10n ** 21n);
      L.append('txlog.jsonl', { step: `repair: top up ${token} by 0.1 NEAR`, signer: A.factory, contract: token, method: 'Transfer', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
      await L.call(`init ${token}.new (repair)`, token, token, 'new', { owner_id: A.core, total_supply: '1000000000000000' }, { gas: L.tgas(100) });
    }
    return token;
  }
  const need = 1.8; // 160,776 B of code at 1e-5 NEAR/byte (1.61) plus the deploy gas (about 0.02) plus margin
  const fbal = await L.balanceRawNear(A.factory);
  const spare = fbal - 1.05; // the factory's own code is staked
  if (spare < need) {
    const top = need - spare + 0.05;
    await rootGuard(top);
    const root = await L.acct(A.owner);
    const out = await root.sendMoney(A.factory, BigInt(Math.round(top * 1e6)) * 10n ** 18n);
    console.log(`topped up ${A.factory} with ${top.toFixed(3)} NEAR tx=${out.transaction.hash}`);
    L.append('txlog.jsonl', { step: `top up ${A.factory} for token ${token}`, signer: A.owner, contract: A.factory, method: 'Transfer', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
  }
  await L.ensureAccount(token, A.factory, need);
  await L.deployWasm(token, path.join(REPO, 'target/near/mock_ft/mock_ft.wasm'), 'new', { owner_id: A.core, total_supply: '1000000000000000' });
  return token;
}

async function ensureActor(name, fund) {
  const acc = `${name}.${A.owner}`;
  if (!(await L.exists(acc))) { await rootGuard(fund); }
  await L.ensureAccount(acc, A.owner, fund);
  return acc;
}
async function registerUsdc(who) {
  if (await L.view(A.usdc, 'storage_balance_of', { account_id: who })) return;
  await L.call(`usdc.storage_deposit ${who}`, A.owner, A.usdc, 'storage_deposit', { account_id: who }, { gas: L.tgas(30), deposit: L.yocto('0.00125') });
}

function params(sym, commitSecs) {
  return { symbol: sym, name: `${sym} Test Token`, total_supply_whole: 1000000000, sale_bps: 6000, lp_bps: 2500, creator_bps: 1000, backer_bps: 500, hard_cap: '1000000000', soft_cap: '350000000', min_buy: '20000000', wallet_bps: 200, min_funders: 10, open_delay_secs: 0, commit_secs: commitSecs, tail_secs: 30, stream_days: 30 };
}
function genesisPlan(spec, id) {
  const uri = `https://kruxa.example/rehearsal/${id}.json`;
  const plan = {
    mode: spec.mode, metadata_uri_sha256: crypto.createHash('sha256').update(uri).digest('hex'), vault_index: 0, disclosure: 'SinglePartyDemo', clawback_days: 90,
    squads_multisig_hash: b58decode32(SQUADS),
  };
  if (spec.mode === 'F0') {
    plan.mint_pubkey_f0 = execFileSync('npx', ['tsx', 'src/f0-key.ts', '--core', A.core, '--launch', String(id)], { cwd: path.join(REPO, 'relayer'), encoding: 'utf8' }).trim();
  }
  return plan;
}

const which = process.argv[2];
const spec = SPECS[which];
if (!spec) { console.error('usage: seed.mjs A|B|C|D|E|F'); process.exit(64); }
const book = readJson('launches.json', {});
if (book[which]) { console.log(`launch ${which} already seeded as id ${book[which].id}`); process.exit(0); }

const commitSecs = Number(process.env.COMMIT_SECS || 200);
const token = await ensureToken(spec.sym);
const creator = await ensureActor(spec.creator, 0.75);
const id = await nextLaunchId();
const holders = Array.from({ length: spec.buyers }, newSolKey);
const holdersFile = path.join(os.homedir(), '.kruxa-secrets', 'genesis', `holders-core3-${id}.json`);
fs.writeFileSync(holdersFile, JSON.stringify(holders.map((h) => h.secret64)), { mode: 0o600 });
const amount = spec.amount * USDC_;
const rec = { id, name: which, note: spec.note, symbol: spec.sym, mode: spec.mode, token, creator, core: A.core, holders_file_local: `~/.kruxa-secrets/genesis/holders-core3-${id}.json`, txs: {}, buyers: [] };

// fund first (the commit window is short): one mint into the mock Intents, one mt_deposit per Solana buyer; native buyers get USDC directly
const total = amount * BigInt(spec.buyers + (spec.natives || []).length);
const mint = await L.call(`${which}: usdc.mint to intents`, A.owner, A.usdc, 'mint', { account_id: A.intents, amount: total.toString() }, { gas: L.tgas(30) });
rec.txs.mint_to_intents = mint.tx;
for (const h of holders) await L.call(`${which}: intents.mt_deposit ${b58(h.pub).slice(0, 6)}`, A.owner, A.intents, 'mt_deposit', { account_id: h.pub.toString('hex'), token_id: `nep141:${A.usdc}`, amount: amount.toString() }, { gas: L.tgas(30) });
const natives = [];
for (const n of spec.natives || []) {
  const acc = await ensureActor(n, 0.15);
  await registerUsdc(acc);
  await L.call(`${which}: usdc.mint to ${acc}`, A.owner, A.usdc, 'mint', { account_id: acc, amount: amount.toString() }, { gas: L.tgas(30) });
  natives.push(acc);
}

const p = params(spec.sym, commitSecs);
const plan = genesisPlan(spec, id);
const need = await L.view(A.core, 'required_deposit', { params: p });
await rootGuard(0);
const created = await L.call(`${which}: create_trial ${spec.sym} (${spec.mode})`, creator, A.core, 'create_trial', { params: p, stream_recipient: null, genesis: plan }, { gas: L.tgas(150), deposit: need });
rec.txs.create_trial = created.tx; rec.create_success = created.success; rec.create_codes = created.rule_codes;
for (let i = 0; i < 40; i++) { const st = await L.view(A.core, 'get_state', { launch_id: String(id) }); if (st && st.status === 'Open') break; if (st && st.status === 'CreationFailed') throw new Error('creation failed'); await L.sleep(3); }
rec.created_at = new Date().toISOString();
console.log(`launch ${id} (${which}) is Open; committing ${holders.length} Solana + ${natives.length} native buyers`);

for (const h of holders) {
  const key = b58(h.pub);
  const msg = JSON.stringify({ v: 1, op: 'contribute', launch_id: String(id), deliver: `sol:${key}`, relay_fee: '0' });
  const intent = { intent: 'transfer', receiver_id: A.core, tokens: { [`nep141:${A.usdc}`]: amount.toString() }, msg, min_gas: '50000000000000' };
  const payload = { signer_id: h.pub.toString('hex'), verifying_contract: A.intents, deadline: '2099-01-01T00:00:00.000Z', nonce: 'AAAA', intents: [intent] };
  const signed = { standard: 'raw_ed25519', payload: JSON.stringify(payload), public_key: 'ed25519:11111111111111111111111111111111', signature: 'ed25519:1' };
  const r = await L.call(`${which}: commit sol:${key.slice(0, 6)} ${spec.amount} USDC`, A.owner, A.intents, 'execute_intents', { signed: [signed] }, { gas: L.tgas(300) });
  rec.buyers.push({ holder: `sol:${key}`, tx: r.tx, success: r.success });
}
for (const acc of natives) {
  const r = await L.call(`${which}: commit ${acc} ${spec.amount} USDC`, acc, A.usdc, 'ft_transfer_call', { receiver_id: A.core, amount: amount.toString(), msg: JSON.stringify({ v: 1, op: 'contribute', launch_id: String(id) }) }, { gas: L.tgas(100), deposit: '1' });
  rec.buyers.push({ holder: `near:${acc}`, tx: r.tx, success: r.success });
}
const st = await L.view(A.core, 'get_state', { launch_id: String(id) });
rec.after_commit = { total_active: st.total_active, active_funders: st.active_funders, holder_count: st.holder_count, phase: st.phase };
book[which] = rec;
writeJson('launches.json', book);
console.log(JSON.stringify(rec.after_commit), 'root NEAR', (await L.balanceRawNear(A.owner)).toFixed(3));
