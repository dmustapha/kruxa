// READ-ONLY. Prints the F0 genesis mint key (64 hex) for a MAINNET launch: derive(v1.signer root key, predecessor = the core account, path kruxa:genesis:<launch>).
// Mainnet twin of relayer/src/f0-key.ts (which refuses non-testnet cores). Reuses relayer/src/derive.ts unchanged. One public view call, no key read.
//   npx --prefix relayer tsx scripts/mainnet/f0-key-mainnet.ts --core <core account> --launch <N>
// Not run against mainnet by the agent: the first run is the owner's read-only check after the core is deployed.
import { derivedKeyBytes } from "../../relayer/src/derive.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const core = arg("--core"), launch = arg("--launch");
const rpc = process.env.KRUXA_NEAR_RPC ?? "https://rpc.mainnet.near.org";
const signer = process.env.KRUXA_SIGNER_CONTRACT ?? "v1.signer";
if (!core || core.endsWith(".testnet") || !launch || !/^\d+$/.test(launch)) { console.error("usage: f0-key-mainnet.ts --core ACCOUNT --launch N (mainnet core only)"); process.exit(64); }
if (/test|dev|local|sandbox/i.test(rpc)) { console.error(`refusing RPC ${rpc}: mainnet only`); process.exit(64); }
const status = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: [] }) })).json() as { result?: { chain_id: string } };
if (status.result?.chain_id !== "mainnet") { console.error("refusing: RPC chain_id is not mainnet"); process.exit(64); }
const res = await fetch(rpc, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: signer, method_name: "public_key", args_base64: Buffer.from(JSON.stringify({ domain_id: 1 })).toString("base64") } }),
});
const j = (await res.json()) as { result?: { result: number[] } };
if (!j.result) throw new Error("could not read the MPC root key");
const rootPk = JSON.parse(Buffer.from(j.result.result).toString("utf8")) as string;
console.log(Buffer.from(derivedKeyBytes(rootPk, core, `kruxa:genesis:${launch}`)).toString("hex"));
