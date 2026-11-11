// Deploys the Kruxa core ("core3") on NEAR TESTNET with the demo profile, reusing the mock USDC / mock Intents / mock factory
// accounts of the earlier stacks, sets the genesis relayer, and records account ids, wasm hashes and tx hashes in evidence/testnet-core3/.
//   KXI_ROOT=kxi-root-1108.testnet node deploy.mjs [core|market]     (default: both; every stage is idempotent)
// Testnet only (common.mjs refuses anything else). Never prints a key. Keeps RESERVE_NEAR on the root.
import fs from 'fs';
import { L, A, wasmPath, onChainSha, sha256Hex, writeJson, readJson } from './common.mjs';

const RESERVE_NEAR = 2;
const CORE_FUND = 7.4; // storage is 1e-5 NEAR/byte: 674,863 B = 6.75 NEAR, plus operating margin
const MARKET_FUND = 2.8; // 261,077 B = 2.61 NEAR
const stage = process.argv[2] || 'all';

async function guard(spendNear) {
  const bal = await L.balanceRawNear(A.owner);
  if (bal - spendNear < RESERVE_NEAR) throw new Error(`root balance ${bal.toFixed(3)} minus ${spendNear} would drop below the ${RESERVE_NEAR} NEAR reserve: stopping`);
}
async function registerOnUsdc(who) {
  const bal = await L.view(A.usdc, 'storage_balance_of', { account_id: who });
  if (bal) return;
  await L.call(`usdc.storage_deposit ${who}`, A.owner, A.usdc, 'storage_deposit', { account_id: who }, { gas: L.tgas(30), deposit: L.yocto('0.00125') });
}
async function deployWithSha(account, name, initMethod, initArgs, fundNear) {
  const file = name === 'kruxa_core' && process.env.KXI_CORE_WASM ? process.env.KXI_CORE_WASM : wasmPath(name); // KXI_CORE_WASM: e.g. artifacts/kruxa_core.reproducible.wasm
  const bytes = fs.readFileSync(file);
  const want = await sha256Hex(bytes);
  if (name === 'kruxa_core' && process.env.EXPECT_SHA256 && process.env.EXPECT_SHA256 !== want) throw new Error(`refusing: ${file} hashes to ${want}, not EXPECT_SHA256`);
  if (!(await L.exists(account))) { await guard(fundNear); }
  await L.ensureAccount(account, A.owner, fundNear);
  await L.deployWasm(account, file, initMethod, initArgs);
  const got = await onChainSha(account);
  if (got !== want) throw new Error(`on-chain sha256 ${got} != build ${want} for ${account}`);
  console.log(`view_code sha256 ${got} == build (${name}, ${bytes.length} B) on ${account}`);
  return { account, wasm: name, bytes: bytes.length, sha256: got };
}

const rec = readJson('deploy.json', { network: 'NEAR TESTNET (play money)', profile: 'demo', accounts: A, deployments: {} });

if (stage === 'all' || stage === 'core') {
  // helper accounts (no contract): relay-fees is new, guardian/treasury exist from the 1108 stack
  await L.ensureAccount(A.guardian, A.owner, 0.1);
  await L.ensureAccount(A.treasury, A.owner, 0.1);
  await guard(0.1);
  await L.ensureAccount(A.relayFees, A.owner, 0.1);
  const init = { owner: A.owner, guardian: A.guardian, treasury: A.treasury, relay_fees: A.relayFees, usdc: A.usdc, intents: A.intents, factory: A.factory, profile: 'demo' };
  rec.deployments.core = await deployWithSha(A.core, 'kruxa_core', 'new', init, CORE_FUND);
  for (const who of [A.core, A.intents, A.treasury, A.relayFees, A.guardian]) await registerOnUsdc(who);
  const cfg0 = await L.view(A.core, 'get_config', {});
  if (cfg0.genesis_relayer !== A.genesisRelayer) {
    const r = await L.call('core.set_genesis_relayer', A.owner, A.core, 'set_genesis_relayer', { account: A.genesisRelayer }, { gas: L.tgas(30) });
    rec.deployments.core.set_genesis_relayer_tx = r.tx;
  }
  rec.deployments.core.config = await L.view(A.core, 'get_config', {});
  writeJson('deploy.json', rec);
}

if (stage === 'all' || stage === 'market') {
  await guard(MARKET_FUND);
  const init = { owner: A.owner, guardian: A.guardian, treasury: A.treasury, usdc: A.usdc, core: A.core, max_pool_reserve_q: null, max_global_reserve_q: null, max_instant_reserve_q: null };
  rec.deployments.market = await deployWithSha(A.market, 'kruxa_market_contract', 'new', init, MARKET_FUND);
  await registerOnUsdc(A.market);
  const cfg = await L.view(A.core, 'get_config', {});
  if (cfg.market !== A.market) {
    const r = await L.call('core.set_market', A.owner, A.core, 'set_market', { account: A.market }, { gas: L.tgas(30) });
    rec.deployments.market.core_set_market_tx = r.tx;
  }
  writeJson('deploy.json', rec);
}
console.log('root balance NEAR:', (await L.balanceRawNear(A.owner)).toFixed(3));
