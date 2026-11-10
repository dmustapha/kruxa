/** Prints the F0 genesis key (64 hex) for a launch: derive(MPC root key, predecessor = the CORE account, path kruxa:genesis:<launch>).
 *  usage: f0-key.ts --core ACCOUNT.testnet --launch N      Read-only (one public view call on the testnet MPC signer); no key is read. */
import { derivedKeyBytes } from "./derive.js";
import { TESTNET_SIGNER } from "./f0.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const core = arg("--core"), launch = arg("--launch");
if (!core || !core.endsWith(".testnet") || !launch || !/^\d+$/.test(launch)) { console.error("usage: f0-key.ts --core ACCOUNT.testnet --launch N"); process.exit(64); }
const rpc = process.env.NEAR_TESTNET_RPC ?? "https://test.rpc.fastnear.com";
const res = await fetch(rpc, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: TESTNET_SIGNER, method_name: "public_key", args_base64: Buffer.from(JSON.stringify({ domain_id: 1 })).toString("base64") } }),
});
const j = (await res.json()) as { result?: { result: number[] } };
if (!j.result) throw new Error("could not read the MPC root key");
const rootPk = JSON.parse(Buffer.from(j.result.result).toString("utf8")) as string;
console.log(Buffer.from(derivedKeyBytes(rootPk, core, `kruxa:genesis:${launch}`)).toString("hex"));
