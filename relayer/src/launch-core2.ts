/** Drives a rehearsal launch on the NEAR TESTNET core to a settled verdict (testnet mocks only: mock USDC, mock Intents, mock factory).
 *  usage: launch-core2.ts --core ACCOUNT --symbol KRXG1 --mode F1|F0 --buyers N [--multisig PUBKEY]
 *  PASS needs N*40 USDC >= 350 USDC and >= 10 funders (N=12). N=5 gives a FAIL launch.
 *  PREREQUISITE (A1): the token account <symbol>.factory.<root> must exist with the mock_ft code and the launch's total supply, owner = core. */
import { createHash } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { derivedKeyBytes } from "./derive.js";
import { TESTNET_SIGNER } from "./f0.js";
import { loadNearKey, testnetAccount } from "./near.js";

const GAS = 300n * 10n ** 12n;
const USDC = 1_000_000n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };

async function main(): Promise<void> {
  const core = arg("--core"), symbol = arg("--symbol"), mode = arg("--mode", "F1")!, buyers = Number(arg("--buyers", "12"));
  if (!core || !symbol || !core.endsWith(".testnet")) {
    console.error("usage: launch-core2.ts --core ACCOUNT.testnet --symbol SYM --mode F1|F0 --buyers N [--multisig PK]");
    process.exit(64);
  }
  const acct = await testnetAccount();
  const root = core.split(".").slice(1).join(".");
  const [usdcId, intentsId] = [`usdc.${root}`, `intents.${root}`];
  const view = <T>(c: string, m: string, a: object) => acct.viewFunction({ contractId: c, methodName: m, args: a }) as Promise<T>;
  const call = (c: string, m: string, a: object, dep = 0n) => acct.functionCall({ contractId: c, methodName: m, args: a, gas: GAS, attachedDeposit: dep });

  let id = 1n;
  while ((await view<unknown>(core, "get_state", { launch_id: id.toString() })) !== null) id++;
  const uri = `https://kruxa.example/rehearsal/${id}.json`;
  const multisig = arg("--multisig", "CneX72zHFJsd71BBZ39xAuBH8zBySsWo6RedYr6j6A1Z")!;
  const plan: Record<string, unknown> = {
    mode, metadata_uri_sha256: createHash("sha256").update(uri).digest("hex"), vault_index: 0, disclosure: "SinglePartyDemo", clawback_days: 90,
    squads_multisig_hash: Buffer.from(new PublicKey(multisig).toBytes()).toString("hex"),
  };
  if (mode === "F0") {
    const rootPk = await view<string>(TESTNET_SIGNER, "public_key", { domain_id: 1 });
    plan.mint_pubkey_f0 = Buffer.from(derivedKeyBytes(rootPk, loadNearKey().account_id, `kruxa:genesis:${id}`)).toString("hex");
  }
  const params = {
    symbol, name: `${symbol} Rehearsal`, total_supply_whole: 1_000_000_000, sale_bps: 6000, lp_bps: 2500, creator_bps: 1000, backer_bps: 500,
    hard_cap: "1000000000", soft_cap: "350000000", min_buy: "20000000", wallet_bps: 200, min_funders: 10, open_delay_secs: 0,
    commit_secs: 90, tail_secs: 30, stream_days: 30,
  };
  const need = await view<string>(core, "required_deposit", { params });
  console.log(`creating launch ${id} (${symbol}, ${mode}), deposit ${need} yocto`);
  const t = await call(core, "create_trial", { params, stream_recipient: null, genesis: plan }, BigInt(need));
  console.log(`create_trial: ${t.transaction.hash}`);

  const holders = Array.from({ length: buyers }, () => Keypair.generate());
  const file = `${homedir()}/.kruxa-secrets/genesis/holders-${id}.json`;
  writeFileSync(file, JSON.stringify(holders.map((h) => Array.from(h.secretKey))), { mode: 0o600 });
  chmodSync(file, 0o600);
  for (const h of holders) {
    const hexKey = Buffer.from(h.publicKey.toBytes()).toString("hex");
    const amount = (40n * USDC).toString();
    await call(usdcId, "mint", { account_id: intentsId, amount });
    await call(intentsId, "mt_deposit", { account_id: hexKey, token_id: `nep141:${usdcId}`, amount });
    const msg = JSON.stringify({ v: 1, op: "contribute", launch_id: id.toString(), deliver: `sol:${h.publicKey.toBase58()}`, relay_fee: "0" });
    const intent = { intent: "transfer", receiver_id: core, tokens: { [`nep141:${usdcId}`]: amount }, msg, min_gas: "50000000000000" };
    const payload = { signer_id: hexKey, verifying_contract: intentsId, deadline: "2099-01-01T00:00:00.000Z", nonce: "AAAA", intents: [intent] };
    const signed = { standard: "raw_ed25519", payload: JSON.stringify(payload), public_key: "ed25519:11111111111111111111111111111111", signature: "ed25519:1" };
    const r = await call(intentsId, "execute_intents", { signed: [signed] });
    console.log(`commit ${bs58.encode(h.publicKey.toBytes()).slice(0, 8)}: ${r.transaction.hash}`);
  }
  for (;;) {
    const st = await view<{ phase: string }>(core, "get_state", { launch_id: id.toString() });
    if (st.phase === "Ready") break;
    await sleep(5000);
  }
  const verdict = await call(core, "settle", { launch_id: id.toString() });
  console.log(`settle: ${verdict.transaction.hash}`);
  const s = await view<{ status: string; holder_count: number }>(core, "get_state", { launch_id: id.toString() });
  console.log(`status: ${s.status}`);
  if (s.status !== "Passed") return;
  for (let from = 0; from < s.holder_count; from += 25) await call(core, "settle_positions_page", { launch_id: id.toString(), from_seq: from, limit: 25 });
  await call(core, "sweep_residue", { launch_id: id.toString() });
  console.log(`launch ${id} settled PASS; holders file ${file} (mode 600)`);
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
