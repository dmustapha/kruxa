// MAINNET (dry-run by default). ONE transaction on the core account: DeployContract(artifacts/kruxa_core.wasm) + FunctionCall `new`.
// Atomic: if `new` fails the deploy is rolled back with it. Verifies the wasm sha256 against artifacts/SHA256SUMS before sending and the
// on-chain code against the same value after. The core account must already exist, be empty, and be funded (see account-plan.mjs).
//   KRUXA_KEY_FILE=<core account key> node scripts/mainnet/deploy-core.mjs
import { accountId, deployPreflight, execute, isEntry, readWasm, runMain, verifyDeployed, view, yoctoToNear } from './lib.mjs';

// Profile 'mainnet': the same capped ladder rules and creator gate as 'ladder' (contracts/core/src/lib.rs), and the ONLY profile whose genesis spec
// targets Solana mainnet-beta (contracts/core/src/genesis.rs build_spec). Any other profile commits a devnet spec, so a Solana mainnet genesis could never pass.
const PROFILE = 'mainnet';
const INIT_GAS_TGAS = 100;
const CAP_NEAR = '0.5'; // gas only: this transaction attaches no deposit

export async function main(ctx) {
  const core = accountId(ctx, 'KRUXA_CORE');
  const init = {
    owner: accountId(ctx, 'KRUXA_OWNER'), guardian: accountId(ctx, 'KRUXA_GUARDIAN'), treasury: accountId(ctx, 'KRUXA_TREASURY'),
    relay_fees: accountId(ctx, 'KRUXA_RELAY_FEES'), usdc: accountId(ctx, 'KRUXA_USDC'), intents: accountId(ctx, 'KRUXA_INTENTS'),
    factory: accountId(ctx, 'KRUXA_FACTORY'), profile: PROFILE,
  };
  const wasm = readWasm('kruxa_core', ctx.artifactsDir); // throws on a hash that differs from artifacts/SHA256SUMS
  const pre = await deployPreflight(ctx, core, wasm);
  const plan = {
    signer: core, receiver: core, capNear: CAP_NEAR, lockedNear: yoctoToNear(pre.lock), blockers: pre.blockers,
    notes: [`wasm ${wasm.file} sha256 ${wasm.sha256} equals artifacts/SHA256SUMS`, 'one tx: DeployContract then `new`; the core keeps its full-access key (disclosed, verify.sh prints it as KEYS)'],
    actions: [{ kind: 'DeployContract', bytes: wasm.bytes, sha256: wasm.sha256 }, { kind: 'FunctionCall', method: 'new', args: init, gasTgas: INIT_GAS_TGAS, depositYocto: '0' }],
  };
  const r = await execute(ctx, plan);
  if (!r.sent) return;
  await verifyDeployed(ctx, core, wasm);
  const cfg = await view(ctx, core, 'get_config');
  if (cfg.profile !== PROFILE || cfg.creator_gate !== true) throw new Error(`core config unexpected: profile ${cfg.profile} creator_gate ${cfg.creator_gate}`);
  ctx.out(`core initialised: profile ${cfg.profile}, creator_gate ${cfg.creator_gate}, global_cap ${cfg.global_cap} (micro-USDC)`);
}
if (isEntry(import.meta.url)) runMain(main);
