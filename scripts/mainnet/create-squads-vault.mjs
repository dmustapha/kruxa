// SOLANA MAINNET (dry-run by default). Creates the Genesis Round Squads v4 vault: 2-of-3, members = the owner's three extension-wallet PUBLIC
// keys, 48 h time lock (172,800 s, ruling R-GR-TIME, never shortened), no config authority (autonomous), no rent collector. DISCLOSED single-party.
// The member wallets sign NOTHING here; a fee-payer key file pays and a throwaway createKey signs.
//   KRUXA_SOL_KEY_FILE=<fee payer, solana-keygen JSON array, mode 600, outside the repo>
//   KRUXA_SQUADS_MEMBERS=<pubkeyA>,<pubkeyB>,<pubkeyC>  KRUXA_SOL_MAINNET_GENESIS_HASH=<hash>  node scripts/mainnet/create-squads-vault.mjs
// Same send gate as the NEAR scripts: KRUXA_MAINNET_CONFIRMED=I_CONFIRM_DAMI_RUNS_THIS plus the typed `SEND <code>`.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { REPO, Refusal, base58ToHex32, isEntry, isSending, need, runMain, sha256Hex, typedConfirmation } from './lib.mjs';

export const TIME_LOCK_SECONDS = 172_800; // 48 h
export const THRESHOLD = 2;
const DEFAULT_SOL_RPC = 'https://api.mainnet-beta.solana.com'; // docs/PRD.md A7
const CAP_LAMPORTS = 200_000_000n; // 0.2 SOL: rent + the Squads creation fee + the transaction fee
const NOT_MAINNET_URL = /devnet|testnet|local|127\./i;

/** Pure: validates env into the plan. Exported for the tests. */
export function vaultPlan(env) {
  const rpc = env.KRUXA_SOL_RPC || DEFAULT_SOL_RPC;
  if (NOT_MAINNET_URL.test(rpc)) throw new Refusal(`refusing Solana RPC ${rpc}: devnet, testnet or local endpoint`);
  const members = (env.KRUXA_SQUADS_MEMBERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (members.length !== 3 || new Set(members).size !== 3) throw new Refusal('KRUXA_SQUADS_MEMBERS must list exactly 3 distinct public keys (Phantom, Solflare, Backpack)');
  members.forEach((m) => base58ToHex32(m)); // throws unless each is a 32-byte base58 key
  const genesisHash = env.KRUXA_SOL_MAINNET_GENESIS_HASH;
  if (!genesisHash || /REPLACE_ME/.test(genesisHash)) throw new Refusal('KRUXA_SOL_MAINNET_GENESIS_HASH is not set (owner to confirm; the script compares it with the RPC)');
  return { rpc, members, threshold: THRESHOLD, timeLock: TIME_LOCK_SECONDS, genesisHash };
}

function loadLibs() {
  const req = createRequire(path.join(REPO, 'tools/squads/'));
  return { web3: req('@solana/web3.js'), multisig: req('@sqds/multisig') };
}
function readFeePayer(web3, ctx) {
  const abs = path.resolve(need(ctx, 'KRUXA_SOL_KEY_FILE'));
  if (abs.startsWith(REPO + path.sep)) throw new Refusal('KRUXA_SOL_KEY_FILE must live outside the repo');
  if ((fs.statSync(abs).mode & 0o077) !== 0) throw new Refusal(`${abs} must be mode 600`);
  return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(abs, 'utf8'))));
}

export async function main(ctx) {
  const plan = vaultPlan(ctx.env);
  const { web3, multisig } = (ctx.solanaLibs || loadLibs)();
  const conn = ctx.solConnection || new web3.Connection(plan.rpc, 'confirmed');
  const hash = await conn.getGenesisHash().catch(() => null);
  if (hash && hash !== plan.genesisHash) throw new Refusal(`refusing: the RPC genesis hash ${hash} is not the configured mainnet hash`);
  ctx.out(hash ? `NETWORK: SOLANA MAINNET (genesis hash matches) via ${plan.rpc}` : `NETWORK: SOLANA MAINNET (unverified, RPC unreachable in dry-run) via ${plan.rpc}`);
  const cfg = hash ? await multisig.accounts.ProgramConfig.fromAccountAddress(conn, multisig.getProgramConfigPda({})[0]).catch(() => null) : null;
  const fee = cfg ? BigInt(cfg.multisigCreationFee.toString()) : null;
  const body = { members: plan.members, threshold: plan.threshold, timeLockSeconds: plan.timeLock, configAuthority: null, rentCollector: null };
  const code = sha256Hex(JSON.stringify(body)).slice(0, 8);
  ctx.out(['---- SQUADS VAULT SUMMARY (SOLANA MAINNET, REAL MONEY) ----', JSON.stringify(body, null, 1),
    `Squads creation fee ${fee === null ? 'unknown (read at send time)' : `${fee} lamports`}; cap ${CAP_LAMPORTS} lamports in total (rent + fee + tx fee)`,
    'single-party custody: all three keys are the owner\'s, DISCLOSED on the charter page', `confirmation code: SEND ${code}`].join('\n'));
  if (fee !== null && fee > CAP_LAMPORTS) throw new Refusal(`REFUSING: creation fee ${fee} lamports exceeds the cap`);
  if (!isSending(ctx)) { ctx.out('DRY RUN: nothing was sent.'); return; }
  if (!hash) throw new Refusal('refusing to send: network not verified');
  await typedConfirmation(ctx, code);
  const payer = readFeePayer(web3, ctx), createKey = web3.Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  const ix = multisig.instructions.multisigCreateV2({
    createKey: createKey.publicKey, creator: payer.publicKey, multisigPda, configAuthority: null, threshold: plan.threshold,
    members: plan.members.map((m) => ({ key: new web3.PublicKey(m), permissions: multisig.types.Permissions.all() })),
    timeLock: plan.timeLock, treasury: cfg.treasury, rentCollector: null,
  });
  const sig = await web3.sendAndConfirmTransaction(conn, new web3.Transaction().add(ix), [payer, createKey]);
  const chain = await multisig.accounts.Multisig.fromAccountAddress(conn, multisigPda);
  if (chain.threshold !== plan.threshold || chain.timeLock !== plan.timeLock) throw new Error('on-chain multisig differs from the plan: stop');
  ctx.out(`SENT sig=${sig}\nmultisig PDA (KRUXA_SQUADS_MULTISIG): ${multisigPda.toBase58()}\nvault PDA index 0 (reserve owner): ${vault.toBase58()}\nthreshold ${chain.threshold} time_lock ${chain.timeLock}`);
}
if (isEntry(import.meta.url)) runMain(main);
