// MAINNET (dry-run by default). ONE transaction on the market account: DeployContract(artifacts/kruxa_market_contract.wasm) + `new`.
// Same checks as deploy-core.mjs. Reserve caps are left at the contract defaults (5,000 / 15,000 USDC, DN-17 interim).
//   KRUXA_KEY_FILE=<market account key> node scripts/mainnet/deploy-market.mjs
import { accountId, deployPreflight, execute, isEntry, readWasm, runMain, verifyDeployed, yoctoToNear } from './lib.mjs';

const INIT_GAS_TGAS = 50;
const CAP_NEAR = '0.5';

export async function main(ctx) {
  const market = accountId(ctx, 'KRUXA_MARKET');
  const init = {
    owner: accountId(ctx, 'KRUXA_OWNER'), guardian: accountId(ctx, 'KRUXA_GUARDIAN'), treasury: accountId(ctx, 'KRUXA_TREASURY'),
    usdc: accountId(ctx, 'KRUXA_USDC'), core: accountId(ctx, 'KRUXA_CORE'),
    max_pool_reserve_q: null, max_global_reserve_q: null, max_instant_reserve_q: null,
  };
  const wasm = readWasm('kruxa_market_contract', ctx.artifactsDir);
  const pre = await deployPreflight(ctx, market, wasm);
  const plan = {
    signer: market, receiver: market, capNear: CAP_NEAR, lockedNear: yoctoToNear(pre.lock), blockers: pre.blockers,
    notes: [`wasm ${wasm.file} sha256 ${wasm.sha256} equals artifacts/SHA256SUMS`, 'the core is told about this market separately (link.mjs set_market), before the first open_market'],
    actions: [{ kind: 'DeployContract', bytes: wasm.bytes, sha256: wasm.sha256 }, { kind: 'FunctionCall', method: 'new', args: init, gasTgas: INIT_GAS_TGAS, depositYocto: '0' }],
  };
  const r = await execute(ctx, plan);
  if (r.sent) await verifyDeployed(ctx, market, wasm);
}
if (isEntry(import.meta.url)) runMain(main);
