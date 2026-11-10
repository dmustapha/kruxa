// Moves spare play-money NEAR from one of our own throwaway accounts back to the root: node sweep-back.mjs <account> <NEAR>
// Testnet only; both ends are accounts of the same stack (root = KXI_ROOT).
import { L, A } from './common.mjs';
const [from, amt] = process.argv.slice(2);
if (!from || !from.endsWith(`.${A.owner}`) || !(Number(amt) > 0)) { console.error('usage: sweep-back.mjs <account under the root> <NEAR>'); process.exit(64); }
const out = await (await L.acct(from)).sendMoney(A.owner, BigInt(Math.round(Number(amt) * 1e6)) * 10n ** 18n);
L.append('txlog.jsonl', { step: `move ${amt} NEAR ${from} -> root`, signer: from, contract: A.owner, method: 'Transfer', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
console.log(`moved ${amt} NEAR from ${from} to ${A.owner} tx=${out.transaction.hash}`);
