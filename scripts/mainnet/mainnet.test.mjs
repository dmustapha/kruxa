// node --test scripts/mainnet/mainnet.test.mjs   Stubs the network: nothing here touches any chain, and no key is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { CONFIRM_ENV, CONFIRM_VALUE, HERE, REPO, Refusal, base58ToHex32, makeCtx, readWasm } from './lib.mjs';
import { main as deployCore } from './deploy-core.mjs';
import { main as deployMarket } from './deploy-market.mjs';
import { main as link } from './link.mjs';
import { main as registerUsdc } from './register-usdc.mjs';
import { main as createAccount } from './create-account.mjs';
import { main as createTrial } from './create-token-and-trial.mjs';
import { main as accountPlan, fundingPlan } from './account-plan.mjs';
import { vaultPlan, main as squads, TIME_LOCK_SECONDS } from './create-squads-vault.mjs';

const OWNER = 'kruxa-owner.near';
const ENV = {
  KRUXA_OWNER: OWNER, KRUXA_GUARDIAN: `guardian.${OWNER}`, KRUXA_TREASURY: `treasury.${OWNER}`, KRUXA_RELAY_FEES: `relay-fees.${OWNER}`,
  KRUXA_CORE: `core.${OWNER}`, KRUXA_MARKET: `market.${OWNER}`, KRUXA_GENESIS_RELAYER: `genesis-relayer.${OWNER}`, KRUXA_PAYOUT: `payout.${OWNER}`,
  KRUXA_USDC: 'a'.repeat(64), KRUXA_INTENTS: 'intents.near', KRUXA_FACTORY: 'factory.near', KRUXA_GENESIS_MODE: 'F1',
  KRUXA_METADATA_URI: 'https://example.invalid/kruxa.json', KRUXA_SQUADS_MULTISIG: '11111111111111111111111111111112',
};
const EMPTY = '11111111111111111111111111111111';

/** A fake JSON-RPC node. accounts: id -> {amount, code_hash, storage_usage}; views: "contract.method" -> value; codes: id -> Buffer. */
function chain({ chainId = 'mainnet', accounts = {}, views = {}, codes = {} } = {}) {
  const calls = [];
  const fetch = async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    calls.push(method);
    const ok = (result) => ({ json: async () => ({ result }) });
    if (method === 'status') return ok({ chain_id: chainId });
    if (params.request_type === 'view_account') {
      const a = accounts[params.account_id];
      return a ? ok({ amount: '0', code_hash: EMPTY, storage_usage: 100, ...a }) : { json: async () => ({ error: { data: 'UNKNOWN_ACCOUNT does not exist' } }) };
    }
    if (params.request_type === 'view_code') return ok({ code_base64: codes[params.account_id].toString('base64') });
    if (params.request_type === 'call_function') {
      const v = views[`${params.account_id}.${params.method_name}`];
      if (v === undefined) return { json: async () => ({ error: { data: 'method not found' } }) };
      return ok({ result: [...Buffer.from(JSON.stringify(typeof v === 'function' ? v(JSON.parse(Buffer.from(params.args_base64, 'base64'))) : v))] });
    }
    throw new Error(`unstubbed ${method}`);
  };
  return { fetch, calls };
}
function harness(env = {}, net = {}, over = {}) {
  const out = [], sent = [], asked = [];
  const c = chain(net);
  const ctx = makeCtx({ env: { ...ENV, ...env }, fetch: c.fetch, out: (s) => out.push(s), ask: async (q) => { asked.push(q); return over.typed ?? ''; }, sendTx: async (_c, plan) => { sent.push(plan); return 'TXHASH'; }, ...over });
  return { ctx, out, sent, asked, text: () => out.join('\n'), calls: c.calls };
}
const confirmed = { [CONFIRM_ENV]: CONFIRM_VALUE };
const coreWasm = fs.readFileSync(path.join(REPO, 'artifacts/kruxa_core.wasm'));
const funded = { [ENV.KRUXA_CORE]: { amount: '9000000000000000000000000' }, [ENV.KRUXA_MARKET]: { amount: '4000000000000000000000000' } };

test('RPC guard refuses test, dev, local and beta endpoints before any request', async () => {
  for (const url of ['https://rpc.testnet.near.org', 'http://127.0.0.1:3030', 'https://test.rpc.fastnear.com', 'https://rpc.devnet.example']) {
    const h = harness({ KRUXA_NEAR_RPC: url }, { accounts: funded });
    await assert.rejects(() => deployCore(h.ctx), /refusing RPC/);
    assert.equal(h.calls.length, 0);
  }
});

test('an RPC that answers chain_id testnet is refused', async () => {
  const h = harness({}, { chainId: 'testnet', accounts: funded });
  await assert.rejects(() => deployCore(h.ctx), /not "mainnet"/);
});

test('deploy-core dry-run prints the exact transaction, names the network and sends nothing', async () => {
  const h = harness({}, { accounts: funded });
  await deployCore(h.ctx);
  const t = h.text();
  assert.match(t, /NETWORK: NEAR MAINNET \(chain_id mainnet\)/);
  assert.match(t, new RegExp(`signer:   ${ENV.KRUXA_CORE}`));
  assert.match(t, new RegExp(`receiver: ${ENV.KRUXA_CORE}`));
  assert.match(t, /"kind":"DeployContract"/);
  assert.match(t, /"method":"new"/);
  assert.match(t, /"profile":"mainnet"/);
  assert.match(t, /"gasTgas":100/);
  assert.match(t, /DRY RUN: nothing was sent/);
  assert.equal(h.sent.length, 0);
  assert.equal(h.asked.length, 0);
});

test('a wrong confirm env value is still a dry-run', async () => {
  const h = harness({ [CONFIRM_ENV]: 'yes' }, { accounts: funded });
  await deployCore(h.ctx);
  assert.equal(h.sent.length, 0);
});

test('confirm env set but the typed text is wrong: aborted, nothing sent', async () => {
  const h = harness(confirmed, { accounts: funded }, { typed: 'SEND 00000000' });
  await assert.rejects(() => deployCore(h.ctx), /ABORTED/);
  assert.equal(h.sent.length, 0);
  assert.equal(h.asked.length, 1);
});

test('confirm env set and the right code typed: ONE transaction, then the on-chain sha256 is checked', async () => {
  let code;
  const dry = harness({}, { accounts: funded });
  await deployCore(dry.ctx);
  code = /confirmation code: (SEND [0-9a-f]{8})/.exec(dry.text())[1];
  const h = harness(confirmed, { accounts: funded, codes: { [ENV.KRUXA_CORE]: coreWasm }, views: { [`${ENV.KRUXA_CORE}.get_config`]: { profile: 'mainnet', creator_gate: true, global_cap: '3000000000' } } }, { typed: code });
  await deployCore(h.ctx);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].actions.length, 2);
  assert.match(h.text(), /CODE MATCH/);
});

test('after the send a code mismatch on chain is a hard failure', async () => {
  const dry = harness({}, { accounts: funded });
  await deployCore(dry.ctx);
  const code = /confirmation code: (SEND [0-9a-f]{8})/.exec(dry.text())[1];
  const h = harness(confirmed, { accounts: funded, codes: { [ENV.KRUXA_CORE]: Buffer.from('tampered') } }, { typed: code });
  await assert.rejects(() => deployCore(h.ctx), /MISMATCH/);
});

test('a wasm that does not match SHA256SUMS aborts before anything is sent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-art-'));
  fs.writeFileSync(path.join(dir, 'kruxa_core.wasm'), 'not the audited build');
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${'0'.repeat(64)}  artifacts/kruxa_core.wasm\n`);
  assert.throws(() => readWasm('kruxa_core', dir), /ABORT.*hashes to/);
  const h = harness(confirmed, { accounts: funded }, { artifactsDir: dir, typed: 'SEND x' });
  await assert.rejects(() => deployCore(h.ctx), /ABORT/);
  assert.equal(h.sent.length, 0);
  assert.equal(h.asked.length, 0);
});

test('the real artifacts match SHA256SUMS', () => {
  assert.equal(readWasm('kruxa_core').sha256.length, 64);
  assert.equal(readWasm('kruxa_market_contract').sha256.length, 64);
});

test('deploy refuses an account that already has code, and an underfunded one', async () => {
  let h = harness({}, { accounts: { [ENV.KRUXA_CORE]: { amount: '9000000000000000000000000', code_hash: 'Abc' } } });
  await assert.rejects(() => deployCore(h.ctx), /already has code/);
  h = harness({}, { accounts: { [ENV.KRUXA_CORE]: { amount: '1000000000000000000000000' } } });
  await assert.rejects(() => deployCore(h.ctx), /fund it first/);
});

test('deploy-market dry-run', async () => {
  const h = harness({}, { accounts: funded });
  await deployMarket(h.ctx);
  assert.match(h.text(), /"max_pool_reserve_q":null/);
  assert.equal(h.sent.length, 0);
});

test('link: one method per run, skips when already set, never sends in dry-run', async () => {
  const cfg = { owner: OWNER, market: null, genesis_relayer: null };
  let h = harness({}, { views: { [`${ENV.KRUXA_CORE}.get_config`]: cfg } });
  await link(h.ctx, ['set_market']);
  assert.match(h.text(), /"method":"set_market"/);
  assert.equal(h.sent.length, 0);
  h = harness({}, { views: { [`${ENV.KRUXA_CORE}.get_config`]: { ...cfg, market: ENV.KRUXA_MARKET } } });
  await link(h.ctx, ['set_market']);
  assert.match(h.text(), /already/);
  await assert.rejects(() => link(h.ctx, ['pause']), /usage/);
});

test('register-usdc skips a registered account and attaches 0.00125 NEAR otherwise', async () => {
  let h = harness({}, { views: { [`${ENV.KRUXA_USDC}.storage_balance_of`]: { total: '1250000000000000000000' } } });
  await registerUsdc(h.ctx, [ENV.KRUXA_CORE]);
  assert.match(h.text(), /already registered/);
  h = harness({}, {});
  await registerUsdc(h.ctx, [ENV.KRUXA_CORE]);
  assert.match(h.text(), /"depositNear":"0.00125"/);
});

test('create-account: only a sub-account, capped funding, no key file written in dry-run', async () => {
  const keyFile = path.join(os.tmpdir(), `kx-newkey-${crypto.randomUUID()}.json`);
  const h = harness({ KRUXA_NEW_KEY_FILE: keyFile }, {}, { newKeyPair: () => ({ publicKey: 'ed25519:TESTPUB', secret: 'ed25519:TESTSECRET' }) });
  await assert.rejects(() => createAccount(h.ctx, ['evil.near', '1']), /usage/);
  await assert.rejects(() => createAccount(h.ctx, [`core.${OWNER}`, '50']), /refused/);
  await createAccount(h.ctx, [`core.${OWNER}`, '7.2']);
  assert.match(h.text(), /"kind":"CreateAccount"/);
  assert.equal(fs.existsSync(keyFile), false);
  assert.doesNotMatch(h.text(), /TESTSECRET/);
});

test('create-account in send mode writes the key file mode 600 before sending and never prints the secret', async () => {
  const keyFile = path.join(os.tmpdir(), `kx-newkey-${crypto.randomUUID()}.json`);
  const base = { KRUXA_NEW_KEY_FILE: keyFile };
  const over = { newKeyPair: () => ({ publicKey: 'ed25519:TESTPUB', secret: 'ed25519:TESTSECRET' }) };
  const dry = harness(base, {}, over);
  await createAccount(dry.ctx, [`core.${OWNER}`, '7.2']);
  const code = /confirmation code: (SEND [0-9a-f]{8})/.exec(dry.text())[1];
  const h = harness({ ...base, ...confirmed }, {}, { ...over, typed: code });
  await createAccount(h.ctx, [`core.${OWNER}`, '7.2']);
  assert.equal(h.sent.length, 1);
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  assert.doesNotMatch(h.text(), /TESTSECRET/);
  fs.rmSync(keyFile);
});

const goodCore = { owner: OWNER, factory: 'factory.near', creator_gate: true, profile: 'mainnet', pause: 'None', global_held: '0' };
const trialViews = (extra = {}) => ({ [`${ENV.KRUXA_CORE}.get_config`]: { ...goodCore, ...extra }, [`${ENV.KRUXA_CORE}.get_state`]: null, [`${ENV.KRUXA_CORE}.required_deposit`]: '270000000000000000000000' });
const okValidate = { validateParams: () => {} };

test('create-trial dry-run prints create_trial with the live deposit, 300 Tgas and the KRUXA params', async () => {
  const h = harness({}, { views: trialViews() }, okValidate);
  await createTrial(h.ctx);
  const t = h.text();
  assert.match(t, /"method":"create_trial"/);
  assert.match(t, /"symbol":"KRUXA"/);
  assert.match(t, /"gasTgas":300/);
  assert.match(t, /"depositNear":"0.27"/);
  assert.match(t, /launch id 1/);
  assert.equal(h.sent.length, 0);
});

test('create-trial refuses: a rule violation, an open creator gate, funds already held, a taken token name, an F0 key for another launch', async () => {
  let h = harness({}, { views: trialViews() }, { validateParams: () => { throw new Refusal('R_WINDOW: commit_secs = 43200 violates 86400..=2592000'); } });
  await assert.rejects(() => createTrial(h.ctx), /R_WINDOW/);
  h = harness({}, { views: trialViews({ creator_gate: false }) }, okValidate);
  await assert.rejects(() => createTrial(h.ctx), /creator_gate is open/);
  h = harness({}, { views: trialViews({ global_held: '5' }) }, okValidate);
  await assert.rejects(() => createTrial(h.ctx), /already holds/);
  h = harness({}, { views: trialViews(), accounts: { 'kruxa.factory.near': {} } }, okValidate);
  await assert.rejects(() => createTrial(h.ctx), /already exists/);
  h = harness({ KRUXA_GENESIS_MODE: 'F0', KRUXA_F0_MINT_PUBKEY_HEX: 'ab'.repeat(32), KRUXA_F0_LAUNCH_ID: '7' }, { views: trialViews() }, okValidate);
  await assert.rejects(() => createTrial(h.ctx), /derived for launch 7/);
});

test('create-trial refuses any symbol except KRUXA and a deposit above the cap', async () => {
  const file = path.join(os.tmpdir(), `kx-params-${crypto.randomUUID()}.json`);
  const p = JSON.parse(fs.readFileSync(path.join(HERE, 'kruxa-trial-params.json'), 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...p, symbol: 'OTHER' }));
  let h = harness({ KRUXA_PARAMS: file }, { views: trialViews() }, okValidate);
  await assert.rejects(() => createTrial(h.ctx), /only KRUXA/);
  h = harness({}, { views: { ...trialViews(), [`${ENV.KRUXA_CORE}.required_deposit`]: '3000000000000000000000000' } }, okValidate);
  await assert.rejects(() => createTrial(h.ctx), /exceeds this script's cap/);
  fs.rmSync(file);
});

test('the shipped params file is the GR-17 numbers', () => {
  const p = JSON.parse(fs.readFileSync(path.join(HERE, 'kruxa-trial-params.json'), 'utf8'));
  assert.deepEqual([p.symbol, p.total_supply_whole, p.sale_bps, p.lp_bps, p.creator_bps, p.backer_bps, p.hard_cap, p.soft_cap, p.min_buy, p.min_funders, p.stream_days],
    ['KRUXA', 1_000_000_000, 6500, 2500, 500, 500, '500000000', '100000000', '10000000', 10, 30]);
});

test('account-plan is read-only and derives funding from the wasm sizes', async () => {
  const f = fundingPlan();
  assert.ok(f.core > 7n * 10n ** 24n && f.core < 8n * 10n ** 24n);
  assert.ok(f.market > 3n * 10n ** 24n && f.market < 4n * 10n ** 24n);
  const h = harness({}, { accounts: { [ENV.KRUXA_OWNER]: { amount: '1000000000000000000000000' }, 'intents.near': { code_hash: 'BtA1BEFNS619KkvXFsgcpQ21Tb5yMm32aaUkn7xNothk' } }, views: { [`${ENV.KRUXA_USDC}.storage_balance_bounds`]: { min: '1250000000000000000000', max: '1250000000000000000000' }, 'v1.signer.version': '3.17.0' } });
  await accountPlan(h.ctx);
  assert.match(h.text(), /MATCHES the pinned hash/);
  assert.match(h.text(), /MISSING/);
  assert.equal(h.sent.length, 0);
});

test('squads plan: exactly three distinct members, 2 of 3, 48 h lock, non-mainnet RPC refused', () => {
  const k = (n) => String.fromCharCode(...[...Array(32)].map(() => 49 + (n % 8))); // base58-valid 32-char strings
  const env = { KRUXA_SQUADS_MEMBERS: `${k(1)}2,${k(2)}3,${k(3)}4`, KRUXA_SOL_MAINNET_GENESIS_HASH: 'HASH' };
  const p = vaultPlan(env);
  assert.equal(p.threshold, 2);
  assert.equal(p.timeLock, 172_800);
  assert.equal(TIME_LOCK_SECONDS, 172_800);
  assert.throws(() => vaultPlan({ ...env, KRUXA_SQUADS_MEMBERS: `${k(1)}2,${k(2)}3` }), /exactly 3/);
  assert.throws(() => vaultPlan({ ...env, KRUXA_SQUADS_MEMBERS: `${k(1)}2,${k(1)}2,${k(3)}4` }), /exactly 3 distinct/);
  assert.throws(() => vaultPlan({ ...env, KRUXA_SOL_RPC: 'https://api.devnet.solana.com' }), /refusing Solana RPC/);
  assert.throws(() => vaultPlan({ ...env, KRUXA_SOL_MAINNET_GENESIS_HASH: undefined }), /GENESIS_HASH/);
});

test('squads dry-run prints the summary and refuses a wrong genesis hash', async () => {
  const k = (n) => `${String.fromCharCode(...[...Array(32)].map(() => 49 + n))}${n}`;
  const env = { KRUXA_SQUADS_MEMBERS: `${k(1)},${k(2)},${k(3)}`, KRUXA_SOL_MAINNET_GENESIS_HASH: 'MAINHASH' };
  const libs = () => ({ web3: {}, multisig: { getProgramConfigPda: () => [null], accounts: { ProgramConfig: { fromAccountAddress: async () => ({ multisigCreationFee: 100_000_000n, treasury: null }) } } } });
  let h = harness(env, {}, { solanaLibs: libs, solConnection: { getGenesisHash: async () => 'MAINHASH' } });
  await squads(h.ctx);
  assert.match(h.text(), /SOLANA MAINNET \(genesis hash matches\)/);
  assert.match(h.text(), /"timeLockSeconds": 172800/);
  assert.match(h.text(), /DRY RUN/);
  h = harness(env, {}, { solanaLibs: libs, solConnection: { getGenesisHash: async () => 'DEVHASH' } });
  await assert.rejects(() => squads(h.ctx), /genesis hash/);
});

test('base58ToHex32 round-trips a 32-byte key and rejects junk', () => {
  assert.equal(base58ToHex32('11111111111111111111111111111112').length, 64);
  assert.throws(() => base58ToHex32('0OIl'), /not base58/);
});

test('CLI: a testnet RPC is refused with exit code 2 and no request', () => {
  const r = spawnSync('node', [path.join(HERE, 'account-plan.mjs')], { env: { ...process.env, KRUXA_NEAR_RPC: 'https://rpc.testnet.near.org' }, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refusing RPC/);
});

test('CLI: verify-mainnet.sh refuses a testnet RPC', () => {
  const r = spawnSync('bash', [path.join(HERE, 'verify-mainnet.sh'), 'ops'], { env: { ...process.env, KRUXA_NEAR_RPC: 'https://test.rpc.fastnear.com', KRUXA_CORE: 'x.near' }, encoding: 'utf8' });
  assert.equal(r.status, 64);
  assert.match(r.stderr, /not a mainnet endpoint/);
});
