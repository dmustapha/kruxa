// MAINNET (dry-run by default). ONE call per run: native USDC `storage_deposit` registering ONE account (0.00125 NEAR, min = max per
// docs/INVARIANTS.md). Accounts that must be registered: core, market, treasury, relay-fees, guardian, payout. Skips if already registered.
//   KRUXA_KEY_FILE=<owner key> node scripts/mainnet/register-usdc.mjs <account_id>
import { Refusal, accountId, execute, isEntry, nearToYocto, runMain, view } from './lib.mjs';

const REGISTRATION = '0.00125';
const GAS_TGAS = 30;

export async function main(ctx, argv = []) {
  const who = argv[0];
  if (!who || !/^[a-z0-9._-]{2,64}$/.test(who)) throw new Refusal('usage: register-usdc.mjs <account_id>');
  const usdc = accountId(ctx, 'KRUXA_USDC'), owner = accountId(ctx, 'KRUXA_OWNER');
  const have = await view(ctx, usdc, 'storage_balance_of', { account_id: who }).catch(() => null);
  if (have) { ctx.out(`${who} is already registered on ${usdc}: nothing to do`); return; }
  await execute(ctx, {
    signer: owner, receiver: usdc, capNear: '0.05',
    actions: [{ kind: 'FunctionCall', method: 'storage_deposit', args: { account_id: who, registration_only: true }, gasTgas: GAS_TGAS, depositYocto: nearToYocto(REGISTRATION).toString() }],
  });
}
if (isEntry(import.meta.url)) runMain(main);
