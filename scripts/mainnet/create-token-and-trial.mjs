// MAINNET (dry-run by default). ONE owner call: core.create_trial for the $KRUXA Genesis Round. The core calls the token factory itself
// (create_token, 110 Tgas) and mints the whole supply to itself, so "create the token" and "create the trial" are this single transaction.
//   KRUXA_KEY_FILE=<owner key> KRUXA_GENESIS_MODE=F0|F1 [KRUXA_F0_MINT_PUBKEY_HEX=<64 hex> KRUXA_F0_LAUNCH_ID=1] node scripts/mainnet/create-token-and-trial.mjs
// Refuses: any symbol but KRUXA (no other token before the brand token), params that fail `kruxa-sim validate --profile ladder --brand`,
// an open creator gate, a core with launches already holding funds, an existing KRUXA token account, a deposit above the cap.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { HERE, REPO, Refusal, accountExists, accountId, base58ToHex32, execute, isEntry, need, runMain, view } from './lib.mjs';

const GAS_TGAS = 300; // R_GAS refuses less than the core's minimum; unused gas is refunded
const CAP_NEAR = '2'; // trial deposit ceiling: bond for up to 500 holders (1.7) + factory deposit 0.06 + registration; the live view gives the real number
const HARD_CAP_MAX = 1_000_000_000n; // $1,000 in micro-USDC (ruling R-37)

/** Default validator: the rule engine itself. Throws with its output when any rule is violated. */
export function validateWithSim(file) {
  try { execFileSync('cargo', ['run', '-q', '-p', 'kruxa-sim', '--', 'validate', '--params', file, '--profile', 'ladder', '--brand'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) {
    throw new Refusal(`kruxa-sim validate refused the params:\n${e.stdout || ''}${e.stderr || ''}`);
  }
}

function genesisPlan(ctx, launchId) {
  const mode = need(ctx, 'KRUXA_GENESIS_MODE');
  if (!['F0', 'F1'].includes(mode)) throw new Refusal('KRUXA_GENESIS_MODE must be F0 or F1');
  const plan = {
    mode, metadata_uri_sha256: crypto.createHash('sha256').update(need(ctx, 'KRUXA_METADATA_URI')).digest('hex'), vault_index: 0,
    disclosure: 'SinglePartyDemo', clawback_days: 90, squads_multisig_hash: base58ToHex32(need(ctx, 'KRUXA_SQUADS_MULTISIG')),
  };
  if (mode === 'F0') {
    const key = need(ctx, 'KRUXA_F0_MINT_PUBKEY_HEX');
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Refusal('KRUXA_F0_MINT_PUBKEY_HEX must be 64 lowercase hex characters (f0-key-mainnet.ts)');
    if (String(ctx.env.KRUXA_F0_LAUNCH_ID) !== String(launchId)) throw new Refusal(`the F0 key was derived for launch ${ctx.env.KRUXA_F0_LAUNCH_ID}, but this trial will be launch ${launchId}: derive it again`);
    plan.mint_pubkey_f0 = key;
  }
  return plan;
}

async function nextLaunchId(ctx, core) {
  let id = 1;
  while ((await view(ctx, core, 'get_state', { launch_id: String(id) })) !== null) id++;
  return id;
}

async function coreChecks(ctx, core, owner) {
  const cfg = await view(ctx, core, 'get_config');
  if (cfg.owner !== owner) throw new Refusal(`core owner is ${cfg.owner}, not ${owner}`);
  if (cfg.creator_gate !== true) throw new Refusal('core creator_gate is open: this must be the first and only owner launch');
  if (cfg.profile !== 'ladder') throw new Refusal(`core profile is ${cfg.profile}, expected ladder`);
  if (cfg.pause !== 'None') throw new Refusal(`core is paused (${cfg.pause})`);
  if (BigInt(cfg.global_held) !== 0n) throw new Refusal(`core already holds ${cfg.global_held} micro-USDC in launches`);
  return cfg;
}

export async function main(ctx) {
  const owner = accountId(ctx, 'KRUXA_OWNER'), core = accountId(ctx, 'KRUXA_CORE');
  const file = path.resolve(ctx.env.KRUXA_PARAMS || path.join(HERE, 'kruxa-trial-params.json'));
  const params = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (params.symbol !== 'KRUXA') throw new Refusal(`symbol is ${params.symbol}: only KRUXA may be created on mainnet before the brand token exists`);
  if (BigInt(params.hard_cap) > HARD_CAP_MAX) throw new Refusal('hard_cap above $1,000');
  (ctx.validateParams || validateWithSim)(file);
  const cfg = await coreChecks(ctx, core, owner);
  const factory = accountId(ctx, 'KRUXA_FACTORY');
  if (cfg.factory !== factory) throw new Refusal(`core was initialised with factory ${cfg.factory}, env says ${factory}`);
  if (await accountExists(ctx, `kruxa.${factory}`)) throw new Refusal(`kruxa.${factory} already exists`);
  const launchId = await nextLaunchId(ctx, core);
  const deposit = BigInt(await view(ctx, core, 'required_deposit', { params }));
  const payout = ctx.env.KRUXA_PAYOUT && !/REPLACE_ME/.test(ctx.env.KRUXA_PAYOUT) ? ctx.env.KRUXA_PAYOUT : null;
  await execute(ctx, {
    signer: owner, receiver: core, capNear: CAP_NEAR,
    notes: [`launch id ${launchId}; params ${file}`, `required_deposit (live view) ${deposit} yocto; the token will be kruxa.${factory}`, `stream recipient ${payout || 'the owner (default)'}; genesis mode ${ctx.env.KRUXA_GENESIS_MODE}`, 'if the factory wants more than the 0.06 NEAR the core attaches, this ends in CreationFailed and the bond is refundable (reclaim_bond)'],
    actions: [{ kind: 'FunctionCall', method: 'create_trial', args: { params, stream_recipient: payout, genesis: genesisPlan(ctx, launchId) }, gasTgas: GAS_TGAS, depositYocto: deposit.toString() }],
  });
}
if (isEntry(import.meta.url)) runMain(main);
