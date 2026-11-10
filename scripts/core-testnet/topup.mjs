// Sends play-money NEAR from the 1108 root to one of its own subaccounts: node topup.mjs <account under the root> <NEAR>. TESTNET only.
import { L, A } from './common.mjs';
const [to, amt] = process.argv.slice(2);
if (!to || !to.endsWith(`.${A.owner}`) || !(Number(amt) > 0)) { console.error('usage: topup.mjs <account under the root> <NEAR>'); process.exit(64); }
const bal = await L.balanceRawNear(A.owner);
if (bal - Number(amt) < 1) { console.error(`root ${bal.toFixed(3)} minus ${amt} would go below the 1 NEAR reserve: stopping`); process.exit(1); }
const out = await (await L.acct(A.owner)).sendMoney(to, BigInt(Math.round(Number(amt) * 1e6)) * 10n ** 18n);
L.append('txlog.jsonl', { step: `top up ${to} by ${amt} NEAR (round 2)`, signer: A.owner, contract: to, method: 'Transfer', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
console.log(`sent ${amt} NEAR to ${to} tx=${out.transaction.hash}`);
