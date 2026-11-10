// Redeploys new code over an EXISTING testnet account (no init, state kept). TESTNET ONLY.
//   node scripts/core-testnet/redeploy.mjs core|market [wasm file]   (default wasm: target/near/<name>/<name>.wasm; hash printed and checked)
//   round 4: redeploy.mjs core artifacts/kruxa_core.reproducible.wasm EXPECT_SHA256=<hex> refuses to send unless the file hashes to the expected value
import fs from 'fs';
import path from 'path';
import { L, A, REPO, onChainSha, sha256Hex } from './common.mjs';

const which = process.argv[2];
const T = { core: [A.core, 'kruxa_core'], market: [A.market, 'kruxa_market_contract'] }[which];
if (!T) throw new Error('usage: redeploy.mjs core|market');
const [account, name] = T;
const file = process.argv[3] ? path.resolve(process.argv[3]) : path.join(REPO, 'target', 'near', name, `${name}.wasm`);
const bytes = fs.readFileSync(file);
const want = await sha256Hex(bytes);
const before = await onChainSha(account);
console.log(`${account} before ${before}\nbuild  ${want} (${bytes.length} B)`);
if (process.env.EXPECT_SHA256 && process.env.EXPECT_SHA256 !== want) { console.error('refusing: file hash differs from EXPECT_SHA256'); process.exit(1); }
if (before === want) { console.log('already equal, nothing to do'); process.exit(0); }
const a = await L.acct(account);
const out = await a.deployContract(bytes);
L.append('txlog.jsonl', { step: `redeploy ${name} to ${account} (${process.env.ROUND_TAG || "round 2"})`, signer: account, contract: account, method: 'DeployContract', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
const got = await onChainSha(account);
console.log(`tx ${out.transaction.hash}\nview_code ${got} ${got === want ? '== build' : 'MISMATCH'}`);
if (got !== want) process.exit(1);
