// Round 4: lends play-money NEAR from core3's spare balance (balance above its storage stake plus 0.5 NEAR) to one of the throwaway
// accounts of this stack. The core contract never reads its native balance. TESTNET only.
//   node core-lend.mjs <account under the 1108 root> <NEAR>
import { L, A } from './common.mjs';
const [to, amt] = process.argv.slice(2);
const ok = to && (to === A.owner || to.endsWith(`.${A.owner}`)) && to !== A.core && Number(amt) > 0;
if (!ok) { console.error('usage: core-lend.mjs <root or account under it, not core3> <NEAR>'); process.exit(64); }
const info = await (await L.net()).connection.provider.query({ request_type: 'view_account', finality: 'optimistic', account_id: A.core });
const bal = Number(BigInt(info.amount)) / 1e24;
const locked = info.storage_usage / 1e5;
if (bal - Number(amt) < locked + 0.5) { console.error(`core3 ${bal.toFixed(3)} minus ${amt} would leave less than storage ${locked.toFixed(3)} + 0.5: stopping`); process.exit(1); }
const out = await (await L.acct(A.core)).sendMoney(to, BigInt(Math.round(Number(amt) * 1e6)) * 10n ** 18n);
L.append('txlog.jsonl', { step: `lend ${amt} NEAR from core3 spare to ${to} (round 4)`, signer: A.core, contract: to, method: 'Transfer', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
console.log(`sent ${amt} NEAR to ${to} tx=${out.transaction.hash}`);
