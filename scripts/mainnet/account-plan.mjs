// READ-ONLY. Prints the mainnet account and funding plan: which accounts exist, their balances, what each needs, and a probe of the
// external contracts the core depends on (USDC, intents.near, v1.signer, the token factory). Sends nothing, needs no key.
//   node scripts/mainnet/account-plan.mjs
import fs from 'fs';
import path from 'path';
import { REPO, STORAGE_YOCTO_PER_BYTE, accountExists, isEntry, networkLine, nearToYocto, need, onChainSha, runMain, view, viewAccount, yoctoToNear } from './lib.mjs';

const INTENTS_CODE_HASH = 'BtA1BEFNS619KkvXFsgcpQ21Tb5yMm32aaUkn7xNothk'; // docs/INVARIANTS.md SOURCE LOCK, read-only mainnet check 2026-11-07
const SIGNER_VERSION = '3.17.0'; // docs/INVARIANTS.md SOURCE LOCK
const NEAR_ACCOUNT_BASE_BYTES = 100n;
const MARGIN = nearToYocto('0.5'); // operating margin kept on each contract account
const wasmBytes = (n) => BigInt(fs.statSync(path.join(REPO, 'artifacts', `${n}.wasm`)).size);
const lockOf = (bytes) => (bytes + NEAR_ACCOUNT_BASE_BYTES) * STORAGE_YOCTO_PER_BYTE;
const ceil01 = (y) => { const u = nearToYocto('0.1'); return ((y + u - 1n) / u) * u; };

/** Funding table in yocto. Derived from wasm sizes at 1e-5 NEAR per byte; the owner row is the sum of everything it must send plus its own spend. */
export function fundingPlan() {
  const core = ceil01(lockOf(wasmBytes('kruxa_core')) + MARGIN);
  const market = ceil01(lockOf(wasmBytes('kruxa_market_contract')) + MARGIN);
  const small = nearToYocto('0.1'); // guardian, treasury, relay-fees: keep a storage floor and pay for the odd call
  const relayer = nearToYocto('0.5'); // genesis relayer: gas for the five relayer methods
  const trial = nearToYocto('2'); // create_trial deposit ceiling (bond for up to 500 holders + factory deposit); the live view gives the real value
  const gasBuffer = nearToYocto('1'), reserve = nearToYocto('1');
  const owner = core + market + 3n * small + relayer + trial + gasBuffer + reserve;
  return { core, market, guardian: small, treasury: small, relayFees: small, genesisRelayer: relayer, owner };
}

const ROLES = [['KRUXA_OWNER', 'owner'], ['KRUXA_GUARDIAN', 'guardian'], ['KRUXA_TREASURY', 'treasury'], ['KRUXA_RELAY_FEES', 'relayFees'],
  ['KRUXA_GENESIS_RELAYER', 'genesisRelayer'], ['KRUXA_CORE', 'core'], ['KRUXA_MARKET', 'market']];

async function accountsSection(ctx) {
  const plan = fundingPlan();
  ctx.out('\n== accounts and funding (storage at 1e-5 NEAR per byte; core and market stake their wasm size)');
  ctx.out(`   core wasm ${wasmBytes('kruxa_core')} B -> lock ${yoctoToNear(lockOf(wasmBytes('kruxa_core')))} NEAR; market wasm ${wasmBytes('kruxa_market_contract')} B -> lock ${yoctoToNear(lockOf(wasmBytes('kruxa_market_contract')))} NEAR`);
  for (const [env, key] of ROLES) {
    const id = ctx.env[env];
    if (!id || /REPLACE_ME/.test(id)) { ctx.out(`   ${env.padEnd(24)} NOT SET            needs ${yoctoToNear(plan[key])} NEAR`); continue; }
    const exists = await accountExists(ctx, id);
    const bal = exists ? BigInt((await viewAccount(ctx, id)).amount) : 0n;
    const gap = bal >= plan[key] ? 0n : plan[key] - bal;
    ctx.out(`   ${env.padEnd(24)} ${id}  ${exists ? 'exists' : 'MISSING'}  balance ${yoctoToNear(bal)}  needs ${yoctoToNear(plan[key])}  shortfall ${yoctoToNear(gap)} NEAR`);
  }
  const payout = ctx.env.KRUXA_PAYOUT;
  ctx.out(`   KRUXA_PAYOUT             ${payout && !/REPLACE_ME/.test(payout) ? payout : 'NOT SET'}  (USDC and creator-stream recipient: must be registered on USDC; owner to confirm, DN-9)`);
  ctx.out(`   owner must hold about ${yoctoToNear(plan.owner)} NEAR in total before M3 (core + market funding, small accounts, trial deposit ceiling, gas, 1 NEAR reserve)`);
}

async function externalsSection(ctx) {
  ctx.out('\n== external contracts (read-only probes)');
  const usdc = ctx.env.KRUXA_USDC || need(ctx, 'KRUXA_USDC');
  const bounds = await view(ctx, usdc, 'storage_balance_bounds').catch((e) => `ERR ${e.message}`);
  ctx.out(`   USDC ${usdc}: storage_balance_bounds ${JSON.stringify(bounds)}  (expected min = max = 1250000000000000000000)`);
  const intents = ctx.env.KRUXA_INTENTS || 'intents.near';
  const ih = (await viewAccount(ctx, intents).catch(() => null))?.code_hash;
  ctx.out(`   Intents ${intents}: code_hash ${ih || 'UNREADABLE'}  ${ih === INTENTS_CODE_HASH ? 'MATCHES the pinned hash in docs/INVARIANTS.md' : `DIFFERS from pinned ${INTENTS_CODE_HASH}: stop and ask the owner`}`);
  const signer = ctx.env.KRUXA_SIGNER_CONTRACT || 'v1.signer';
  const ver = await view(ctx, signer, 'version').catch((e) => `ERR ${e.message}`);
  ctx.out(`   Chain Signatures ${signer}: version ${JSON.stringify(ver)}  (pinned ${SIGNER_VERSION})`);
  await factorySection(ctx);
}

async function factorySection(ctx) {
  const factory = ctx.env.KRUXA_FACTORY;
  if (!factory || /REPLACE_ME/.test(factory)) { ctx.out('   Factory: KRUXA_FACTORY NOT SET (owner to confirm; PRD A5 names token.primitives.near, X-4 leaves tkn.primitives.near open)'); return; }
  const acc = await viewAccount(ctx, factory).catch(() => null);
  ctx.out(`   Factory ${factory}: ${acc ? `exists, code_hash ${acc.code_hash}, storage_usage ${acc.storage_usage}` : 'DOES NOT EXIST ON MAINNET: do not init the core with it'}`);
  const token = `kruxa.${factory}`;
  ctx.out(`   Token account ${token}: ${(await accountExists(ctx, token)) ? 'ALREADY EXISTS: the symbol KRUXA is taken, stop' : 'free'}`);
  ctx.out('   The factory create_token cost and refund are UNPROVEN on mainnet (O-9): the core attaches a fixed 0.06 NEAR; a factory that wants more makes create_trial end in CreationFailed (bond refundable).');
}

export async function main(ctx) {
  await networkLine(ctx, false);
  await accountsSection(ctx);
  await externalsSection(ctx);
  const code = ctx.env.KRUXA_CORE && !/REPLACE_ME/.test(ctx.env.KRUXA_CORE) && (await accountExists(ctx, ctx.env.KRUXA_CORE)) ? await onChainSha(ctx, ctx.env.KRUXA_CORE).catch(() => null) : null;
  ctx.out(`\n== core code on chain: ${code || 'none deployed'}`);
}
if (isEntry(import.meta.url)) runMain(main);
