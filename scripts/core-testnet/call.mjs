// One signed testnet call (or view) with the evidence log: node call.mjs <signer|--view> <contract> <method> '<json args>' [Tgas] [depositNEAR]
// Testnet only; keys are read from ~/.kruxa-secrets by lib.mjs.
import { L } from './common.mjs';
const [signer, contract, method, json = '{}', tgas = '100', dep = '0'] = process.argv.slice(2);
if (!signer || !contract || !method) { console.error("usage: call.mjs <signer|--view> <contract> <method> '<json>' [Tgas] [depositNEAR]"); process.exit(64); }
if (!contract.endsWith('.testnet') && !/^[0-9a-f]{64}$/.test(contract)) { console.error('refusing: testnet accounts only'); process.exit(1); }
if (signer === '--view') { console.log(JSON.stringify(await L.view(contract, method, JSON.parse(json)), null, 2)); process.exit(0); }
const r = await L.call(`${method} (${signer})`, signer, contract, method, JSON.parse(json), { gas: L.tgas(Number(tgas)), deposit: dep === '0' ? '0' : L.yocto(dep) });
console.log(JSON.stringify({ tx: r.tx, success: r.success, codes: r.rule_codes, value: r.value, receipts: r.receipts }));
process.exit(r.success ? 0 : 3);
