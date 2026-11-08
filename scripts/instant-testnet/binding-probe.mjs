// Stage 5: the fixed launcher (merged ws/instant2 wasm) on a .testnet account: profile validation and account binding (review M-02).
import crypto from 'crypto';
import fs from 'fs';
import { ROOT, id, ensureAccount, deployWasm, call, view, append, tgas } from './lib.mjs';
const W = new URL('../../target/near/kruxa_instant_contract/kruxa_instant_contract.wasm', import.meta.url).pathname;
const V2 = id('demo-instant-v2');
await ensureAccount(V2, ROOT, 3.0);
await deployWasm(V2, W);
const base = { owner: ROOT, guardian: id('guardian'), treasury: id('treasury'), usdc: id('usdc'), factory: id('factory') };
const res = [];
for (const p of ['Mainnet', 'prod', 'mainnet']) {
  const r = await call(`new with profile "${p}" on a .testnet account (expect refusal)`, V2, V2, 'new', { ...base, profile: p }, { gas: tgas(50), expectFail: true });
  res.push({ profile: p, refused: !r.success, codes: r.rule_codes, tx: r.tx });
}
const ok = await call('new with profile "demo" on a .testnet account', V2, V2, 'new', { ...base, profile: 'demo' }, { gas: tgas(50) });
res.push({ profile: 'demo', refused: !ok.success, tx: ok.tx });
const cfg = await view(V2, 'get_config');
append('findings.jsonl', { finding: 'M-02 fix on testnet: profile validation and account binding', wasm_sha256: crypto.createHash('sha256').update(fs.readFileSync(W)).digest('hex'), results: res, config_profile: cfg.profile, unit_ns: cfg.unit_ns });
console.log(JSON.stringify(res));
