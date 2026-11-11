// FG-11 on NEAR TESTNET (play money): a small trial on core4 that Walk turns into a FAIL, then refunds and dissolve.
//   node lifecycle-fail.mjs open     fund, create the trial (hard cap 500, soft cap 350, 10 funders at 36 USDC), commit all 10
//   node lifecycle-fail.mjs cancel   (TRIAL_SYMBOL=LCX1) a second trial the creator cancels in the commit window: refunds, dissolve, reclaim_bond
//   node lifecycle-fail.mjs finish   Walk in the tail (one NEAR `walk`, one Solana `walk_signed`), settle (FAIL), claim_refund, claim_refund_batch, dissolve
// Needs KXI_CORE=core4.kxi-root-1108.testnet, KXI_EVID=<repo>/evidence/testnet-core3/lifecycle, KXI_RPC=<retry proxy>. TESTNET ONLY.
// Keys come from ~/.kruxa-secrets via lib.mjs and are never printed. The 7 Solana holder keys are saved mode 600 under ~/.kruxa-secrets/genesis/.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { L, A, REPO, writeJson, readJson } from './common.mjs';

const USDC_ = 1_000_000n;
const SYMBOL = process.env.TRIAL_SYMBOL || 'LCW1';
const AMOUNT = 36n * USDC_;
const NEAR_HOLDERS = ['sw-h1', 'sw-h3', 'sw-h4'].map((n) => `${n}.${A.owner}`);
const N_SOL = 7;
const KEEPER = `keeper.${A.owner}`;
const CREATOR = `creator-a.${A.owner}`;
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const near = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
const secretsFile = path.join(os.homedir(), '.kruxa-secrets', 'genesis', `lifecycle-core4-${SYMBOL}.json`);

const b58 = (buf) => {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex')); let s = '';
  while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
};
function solKey(secret) { // secret = { d, x } (base64url ed25519 seed and public key)
  const priv = crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: secret.d, x: secret.x }, format: 'jwk' });
  return { priv, pub: Buffer.from(secret.x, 'base64url') };
}
function newSolSecrets(n) {
  return Array.from({ length: n }, () => { const j = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }); return { d: j.d, x: j.x }; });
}

async function sendNear(from, to, amount, step) {
  const out = await (await L.acct(from)).sendMoney(to, near(amount));
  L.append('txlog.jsonl', { step, signer: from, contract: to, method: 'Transfer', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
  console.log(`OK   ${step} tx=${out.transaction.hash}`);
}
async function topUp(name, floor, from) {
  const bal = await L.balanceRawNear(name);
  if (bal < floor) await sendNear(from, name, Math.ceil((floor - bal) * 1000) / 1000, `top up ${name} to ${floor} NEAR from ${from}`);
}
async function ensureToken(symbol) {
  const token = `${symbol.toLowerCase()}.${A.factory}`;
  if (await L.exists(token)) {
    const q = await (await L.net()).connection.provider.query({ request_type: 'view_account', finality: 'optimistic', account_id: token });
    if (q.code_hash !== '11111111111111111111111111111111') return token;
    await sendNear(A.owner, token, 0.25, `top up ${token}: the 188 kB mock FT needs about 1.9 NEAR of storage`); // the first deploy ran short by 0.098
  } else {
    const spare = (await L.balanceRawNear(A.factory)) - 1.05;
    if (spare < 2.05) await sendNear(A.owner, A.factory, 2.1 - spare, `top up ${A.factory} for token ${token}`);
    await L.ensureAccount(token, A.factory, 2.05);
  }
  await L.deployWasm(token, path.join(REPO, 'target/near/mock_ft/mock_ft.wasm'), 'new', { owner_id: A.core, total_supply: '1000000000000000' });
  return token;
}
const params = (commitSecs = 200, tailSecs = 150) => ({
  symbol: SYMBOL, name: `${SYMBOL} Lifecycle Test`, total_supply_whole: 1000000000, sale_bps: 6000, lp_bps: 2500, creator_bps: 1000, backer_bps: 500,
  hard_cap: '500000000', soft_cap: '350000000', min_buy: '20000000', wallet_bps: 200, min_funders: 10, open_delay_secs: 30, commit_secs: commitSecs, tail_secs: tailSecs, stream_days: 30,
});
async function views(label, id, holders) {
  const v = { label, at: new Date().toISOString(), core: A.core, launch_id: id, config: await L.view(A.core, 'get_config', {}) };
  for (const m of ['get_phase', 'get_state', 'get_ledger', 'get_invariants', 'get_settlement']) v[m] = await L.view(A.core, m, { launch_id: id });
  v.positions = {};
  for (const h of holders) v.positions[h] = await L.view(A.core, 'get_position', { launch_id: id, holder: h });
  v.usdc = {};
  for (const h of holders.filter((x) => x.startsWith('near:'))) v.usdc[h] = await L.view(A.usdc, 'ft_balance_of', { account_id: h.slice(5) });
  v.usdc[A.core] = await L.view(A.usdc, 'ft_balance_of', { account_id: A.core });
  v.intents_usdc = {};
  for (const h of holders.filter((x) => x.startsWith('sol:'))) v.intents_usdc[h] = await L.view(A.intents, 'mt_balance_of', { account_id: Buffer.from(solPub(h)).toString('hex'), token_id: `nep141:${A.usdc}` }).catch((e) => `n/a ${String(e.message).slice(0, 50)}`);
  writeJson(`views-fail-${label}.json`, v);
  return v;
}
const solPub = (h) => { let n = 0n; for (const c of h.slice(4)) n = n * 58n + BigInt(ALPHA.indexOf(c)); return Buffer.from(n.toString(16).padStart(64, '0'), 'hex'); };
async function waitPhase(id, want) {
  for (let i = 0; i < 200; i++) { const p = await L.view(A.core, 'get_phase', { launch_id: id }); if (p.phase === want) return p; await L.sleep(3); }
  throw new Error(`phase ${want} not reached`);
}

async function open() {
  if (readJson('fail-trial.json', null)) throw new Error('fail-trial.json exists: already opened');
  await topUp(A.owner, 4.6, 'kx-fund-1112.testnet');
  const sol = newSolSecrets(N_SOL).map(solKey);
  fs.writeFileSync(secretsFile, JSON.stringify(sol.map((s) => ({ d: s.priv.export({ format: 'jwk' }).d, x: s.pub.toString('base64url') }))), { mode: 0o600 });
  const token = await ensureToken(SYMBOL);
  const p = params();
  const need = await L.view(A.core, 'required_deposit', { params: p });
  const gasReserve = 0.32;
  await topUp(CREATOR, Number(BigInt(need) / 10n ** 18n) / 1e6 + gasReserve + 0.05, A.owner);
  for (const n of NEAR_HOLDERS) {
    await topUp(n, 0.2, 'kx-fund-1112.testnet');
    const held = BigInt(await L.view(A.usdc, 'ft_balance_of', { account_id: n }));
    if (held < AMOUNT) await L.call(`usdc.mint ${AMOUNT - held} to ${n}`, A.owner, A.usdc, 'mint', { account_id: n, amount: (AMOUNT - held).toString() }, { gas: L.tgas(30) });
  }
  await L.call('usdc.mint to intents for the Solana holders', A.owner, A.usdc, 'mint', { account_id: A.intents, amount: (AMOUNT * BigInt(N_SOL)).toString() }, { gas: L.tgas(30) });
  for (const s of sol) await L.call(`intents.mt_deposit sol:${b58(s.pub).slice(0, 6)}`, A.owner, A.intents, 'mt_deposit', { account_id: s.pub.toString('hex'), token_id: `nep141:${A.usdc}`, amount: AMOUNT.toString() }, { gas: L.tgas(30) });
  let id = 1;
  while ((await L.view(A.core, 'get_state', { launch_id: String(id) })) !== null) id++;
  const before = await L.view(A.core, 'get_config', {});
  const created = await L.call(`create_trial ${SYMBOL} (hard cap 500, soft cap 350, min 10 funders)`, CREATOR, A.core, 'create_trial', { params: p, stream_recipient: null, genesis: null }, { gas: L.tgas(300), deposit: need });
  if (!created.success) throw new Error('create_trial failed');
  await waitPhase(String(id), 'Open');
  const lid = String(id);
  const rec = { launch_id: lid, symbol: SYMBOL, token, create_tx: created.tx, global_held_before: before.global_held, near_holders: NEAR_HOLDERS, sol_holders: sol.map((s) => `sol:${b58(s.pub)}`), commits: [] };
  const nearCommits = NEAR_HOLDERS.map((n) => L.call(`commit ${n} 36 USDC`, n, A.usdc, 'ft_transfer_call', { receiver_id: A.core, amount: AMOUNT.toString(), msg: JSON.stringify({ v: 1, op: 'contribute', launch_id: lid }) }, { gas: L.tgas(100), deposit: '1' }));
  const solCommits = (async () => {
    const out = [];
    for (const s of sol) out.push(await commitSol(s, lid));
    return out;
  })();
  const all = [...await Promise.all(nearCommits), ...await solCommits];
  rec.commits = all.map((r) => ({ step: r.step, tx: r.tx, success: r.success }));
  writeJson('fail-trial.json', rec);
  await views('1-after-commits', lid, [...NEAR_HOLDERS.map((n) => `near:${n}`), ...rec.sol_holders]);
  console.log(`launch ${lid} open with ${all.filter((r) => r.success).length} of ${all.length} commits; run finish before the tail ends`);
}
async function commitSol(s, lid) {
  const key = b58(s.pub);
  const msg = JSON.stringify({ v: 1, op: 'contribute', launch_id: lid, deliver: `sol:${key}`, relay_fee: '0' });
  const intent = { intent: 'transfer', receiver_id: A.core, tokens: { [`nep141:${A.usdc}`]: AMOUNT.toString() }, msg, min_gas: '50000000000000' };
  const payload = { signer_id: s.pub.toString('hex'), verifying_contract: A.intents, deadline: '2099-01-01T00:00:00.000Z', nonce: 'AAAA', intents: [intent] };
  const signed = { standard: 'raw_ed25519', payload: JSON.stringify(payload), public_key: 'ed25519:11111111111111111111111111111111', signature: 'ed25519:1' };
  return L.call(`commit sol:${key.slice(0, 6)} 36 USDC (mock Intents, Solana-delivered)`, A.owner, A.intents, 'execute_intents', { signed: [signed] }, { gas: L.tgas(300) });
}

function walkSignature(s, lid, nonce, deadline) {
  const msg = `kruxa:walk:v1|${A.core}|${lid}|sol:${b58(s.pub)}|${nonce}|${deadline}`;
  return b58(crypto.sign(null, Buffer.from(msg), s.priv));
}
const claimBatch = async (lid, holders, who) => L.call(`claim_refund_batch launch ${lid} (${holders.length} holders, by ${who})`, who, A.core, 'claim_refund_batch', { launch_id: lid, holders }, { gas: L.tgas(300) });

async function finish() {
  const rec = readJson('fail-trial.json', null);
  if (!rec) throw new Error('run open first');
  const lid = rec.launch_id;
  const sol = JSON.parse(fs.readFileSync(secretsFile, 'utf8')).map(solKey);
  const holders = [...rec.near_holders.map((n) => `near:${n}`), ...rec.sol_holders];
  await waitPhase(lid, 'Closing'); // the tail: the commit window is over, Walk is still open
  const preWalk = await views('2-tail-before-walk', lid, holders);
  const walkNear = rec.near_holders[0];
  const w1 = await L.call(`walk launch ${lid} in the tail (${walkNear}, NEAR key, 1 yocto)`, walkNear, A.core, 'walk', { launch_id: lid }, { gas: L.tgas(100), deposit: '1' });
  const nonce = 1, deadline = (BigInt(Date.now()) * 1_000_000n + 3_600_000_000_000n).toString();
  const w2 = await L.call(`walk_signed launch ${lid} in the tail (${rec.sol_holders[0]}, ed25519 signature, submitted by keeper)`, KEEPER, A.core, 'walk_signed', { launch_id: lid, holder: rec.sol_holders[0], nonce: String(nonce), deadline, signature: walkSignature(sol[0], lid, nonce, deadline) }, { gas: L.tgas(100) });
  await L.call(`walk launch ${lid} again (${walkNear}, expect refused: nothing active)`, walkNear, A.core, 'walk', { launch_id: lid }, { gas: L.tgas(100), deposit: '1', expectFail: true });
  await L.sleep(8);
  await views('3-tail-after-walk', lid, holders);
  const p = await waitPhase(lid, 'Ready');
  await L.call(`dissolve launch ${lid} before the verdict (expect refused R_NOT_CLEAR)`, KEEPER, A.core, 'dissolve', { launch_id: lid }, { gas: L.tgas(100), expectFail: true });
  await L.call(`settle launch ${lid}`, KEEPER, A.core, 'settle', { launch_id: lid }, { gas: L.tgas(100) });
  await L.sleep(5);
  await L.call(`settle_positions_page launch ${lid}`, KEEPER, A.core, 'settle_positions_page', { launch_id: lid, from_seq: 0, limit: 25 }, { gas: L.tgas(100) });
  await L.sleep(5);
  await views('4-after-settle', lid, holders);
  await L.call(`dissolve launch ${lid} with refunds still due (expect refused R_NOT_CLEAR)`, KEEPER, A.core, 'dissolve', { launch_id: lid }, { gas: L.tgas(100), expectFail: true });
  const selfClaimer = rec.near_holders[1];
  await L.call(`claim_refund launch ${lid} (${selfClaimer}, called by the holder)`, selfClaimer, A.core, 'claim_refund', { launch_id: lid, holder: null }, { gas: L.tgas(100) });
  await claimBatch(lid, [`near:${rec.near_holders[2]}`, rec.sol_holders[1]], KEEPER);
  for (const h of rec.sol_holders.slice(2)) await L.call(`claim_refund launch ${lid} (${h.slice(0, 10)}, called by keeper, paid to the position's Intents account)`, KEEPER, A.core, 'claim_refund', { launch_id: lid, holder: h }, { gas: L.tgas(100) });
  await L.sleep(10);
  await views('5-after-refunds', lid, holders);
  await L.call(`dissolve launch ${lid} (every refund cleared)`, KEEPER, A.core, 'dissolve', { launch_id: lid }, { gas: L.tgas(100) });
  await L.sleep(5);
  const fin = await views('6-after-dissolve', lid, holders);
  console.log(`status ${fin.get_state.status}, invariants all_ok ${fin.get_invariants.all_ok}, walk txs ${w1.tx} ${w2.tx}`, p.phase, preWalk.get_state.active_funders);
}

// A trial the creator cancels inside the commit window: every position becomes refundable at once, nobody walked, so every record can be deleted and dissolve is reachable.
async function nextLaunchId() {
  let id = 1;
  while ((await L.view(A.core, 'get_state', { launch_id: String(id) })) !== null) id++;
  return String(id - 1);
}
async function createCancelTrial(sol, nearHolders) {
  fs.writeFileSync(secretsFile, JSON.stringify([{ d: sol.priv.export({ format: 'jwk' }).d, x: sol.pub.toString('base64url') }]), { mode: 0o600 });
  await ensureToken(SYMBOL);
  const p = params(120, 30);
  const need = await L.view(A.core, 'required_deposit', { params: p });
  await topUp(CREATOR, Number(BigInt(need) / 10n ** 18n) / 1e6 + 0.32 + 0.05, A.owner);
  for (const n of nearHolders) {
    const held = BigInt(await L.view(A.usdc, 'ft_balance_of', { account_id: n }));
    if (held < AMOUNT) await L.call(`usdc.mint ${AMOUNT - held} to ${n}`, A.owner, A.usdc, 'mint', { account_id: n, amount: (AMOUNT - held).toString() }, { gas: L.tgas(30) });
  }
  await L.call('usdc.mint to intents for the Solana holder', A.owner, A.usdc, 'mint', { account_id: A.intents, amount: AMOUNT.toString() }, { gas: L.tgas(30) });
  await L.call(`intents.mt_deposit sol:${b58(sol.pub).slice(0, 6)}`, A.owner, A.intents, 'mt_deposit', { account_id: sol.pub.toString('hex'), token_id: `nep141:${A.usdc}`, amount: AMOUNT.toString() }, { gas: L.tgas(30) });
  const created = await L.call(`create_trial ${SYMBOL} (to be cancelled)`, CREATOR, A.core, 'create_trial', { params: p, stream_recipient: null, genesis: null }, { gas: L.tgas(300), deposit: need });
  if (!created.success) throw new Error('create_trial failed');
  return created;
}
async function cancel() {
  const resume = process.env.RESUME_LAUNCH; // set after a crash between create_trial and the commits (the proxy died once): reuses the saved Solana key and the open launch
  const sol = resume ? solKey(JSON.parse(fs.readFileSync(secretsFile, 'utf8'))[0]) : solKey(newSolSecrets(1)[0]);
  const nearHolders = NEAR_HOLDERS.slice(0, 2);
  const token = `${SYMBOL.toLowerCase()}.${A.factory}`;
  const created = resume ? { tx: 'resumed' } : await createCancelTrial(sol, nearHolders);
  const lid = resume || await nextLaunchId();
  await waitPhase(lid, 'Open');
  const solHolder = `sol:${b58(sol.pub)}`;
  const holders = [...nearHolders.map((n) => `near:${n}`), solHolder];
  await Promise.all(nearHolders.map((n) => L.call(`commit ${n} 36 USDC`, n, A.usdc, 'ft_transfer_call', { receiver_id: A.core, amount: AMOUNT.toString(), msg: JSON.stringify({ v: 1, op: 'contribute', launch_id: lid }) }, { gas: L.tgas(100), deposit: '1' })));
  await commitSol(sol, lid);
  await views('c1-after-commits', lid, holders);
  await L.call(`cancel_trial launch ${lid} by a non-creator (expect refused R_NOT_AUTHORIZED)`, KEEPER, A.core, 'cancel_trial', { launch_id: lid }, { gas: L.tgas(100), expectFail: true });
  const c = await L.call(`cancel_trial launch ${lid} by the creator inside the commit window`, CREATOR, A.core, 'cancel_trial', { launch_id: lid }, { gas: L.tgas(100) });
  await L.sleep(4);
  await views('c2-after-cancel', lid, holders);
  for (const n of nearHolders) await L.call(`claim_refund launch ${lid} (${n}, called by the holder)`, n, A.core, 'claim_refund', { launch_id: lid, holder: null }, { gas: L.tgas(100) });
  await L.call(`claim_refund launch ${lid} (${solHolder.slice(0, 10)}, called by keeper)`, KEEPER, A.core, 'claim_refund', { launch_id: lid, holder: solHolder }, { gas: L.tgas(100) });
  await L.sleep(10);
  await views('c3-after-refunds', lid, holders);
  await L.call(`dissolve launch ${lid} (every refund cleared)`, KEEPER, A.core, 'dissolve', { launch_id: lid }, { gas: L.tgas(100) });
  await L.sleep(4);
  await L.call(`reclaim_bond launch ${lid} (creator)`, CREATOR, A.core, 'reclaim_bond', { launch_id: lid }, { gas: L.tgas(100) });
  await L.sleep(8);
  const fin = await views('c4-after-dissolve', lid, holders);
  writeJson('cancel-trial.json', { launch_id: lid, symbol: SYMBOL, token, create_tx: created.tx, cancel_tx: c.tx, holders });
  console.log(`status ${fin.get_state.status}, invariants all_ok ${fin.get_invariants.all_ok}`);
}

const phase = process.argv[2];
if (phase === 'open') await open();
else if (phase === 'finish') await finish();
else if (phase === 'cancel') await cancel();
else { console.error('usage: lifecycle-fail.mjs open|finish|cancel'); process.exit(64); }
