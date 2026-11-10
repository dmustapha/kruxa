// Moves spare play-money NEAR from contract-less throwaway funding accounts (listed below, ours, keys in ~/.kruxa-secrets) to the 1108 root.
// Each keeps 0.06 NEAR. TESTNET only. node sweep-many.mjs
import { L, A } from './common.mjs';
const FROM = ['creator-a', 'creator-b', 'creator-c', 'creator-d', 'buyer', 'buyer2'].map((n) => `${n}.kxi-root-0811.testnet`)
  .concat(['kxi-fund-a-0811.testnet', 'kxi-fund-b-0811.testnet', 'kxi-fund-a-1108.testnet', 'kxi-fund-b-1108.testnet', 'kxi-root-0811.testnet']);
for (const from of FROM) {
  if (!(await L.exists(from))) continue;
  const bal = await L.balanceRawNear(from);
  const amt = Math.floor((bal - 0.06) * 1000) / 1000;
  if (amt < 0.1) continue;
  const out = await (await L.acct(from)).sendMoney(A.owner, BigInt(Math.round(amt * 1e6)) * 10n ** 18n);
  L.append('txlog.jsonl', { step: `move ${amt} NEAR ${from} -> root (round 2)`, signer: from, contract: A.owner, method: 'Transfer', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
  console.log(`moved ${amt} NEAR from ${from} tx=${out.transaction.hash}`);
}
console.log('root', (await L.balanceRawNear(A.owner)).toFixed(3));
