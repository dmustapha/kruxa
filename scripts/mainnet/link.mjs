// MAINNET (dry-run by default). ONE owner call on the core per run:
//   node scripts/mainnet/link.mjs set_genesis_relayer     (account from KRUXA_GENESIS_RELAYER)
//   node scripts/mainnet/link.mjs set_market              (account from KRUXA_MARKET; must happen before the first open_market)
// Skips (and says so) when get_config already holds the value. KRUXA_KEY_FILE = the owner's key.
import { Refusal, accountId, execute, isEntry, runMain, view } from './lib.mjs';

const GAS_TGAS = 30;
const CAP_NEAR = '0.05';
const METHODS = { set_genesis_relayer: ['KRUXA_GENESIS_RELAYER', 'genesis_relayer'], set_market: ['KRUXA_MARKET', 'market'] };

export async function main(ctx, argv = []) {
  const method = argv[0];
  if (!METHODS[method]) throw new Refusal('usage: link.mjs set_genesis_relayer|set_market');
  const [envName, cfgKey] = METHODS[method];
  const core = accountId(ctx, 'KRUXA_CORE'), owner = accountId(ctx, 'KRUXA_OWNER'), account = accountId(ctx, envName);
  const cfg = await view(ctx, core, 'get_config').catch(() => null);
  if (cfg && cfg.owner !== owner) throw new Refusal(`core owner is ${cfg.owner}, not ${owner}`);
  if (cfg && cfg[cfgKey] === account) { ctx.out(`${core}.get_config.${cfgKey} is already ${account}: nothing to do`); return; }
  await execute(ctx, {
    signer: owner, receiver: core, capNear: CAP_NEAR,
    notes: [cfg ? `current ${cfgKey}: ${JSON.stringify(cfg[cfgKey])}` : 'core config not readable (core not deployed yet?): the call would fail'],
    actions: [{ kind: 'FunctionCall', method, args: { account }, gasTgas: GAS_TGAS, depositYocto: '0' }],
  });
}
if (isEntry(import.meta.url)) runMain(main);
