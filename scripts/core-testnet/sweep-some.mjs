// Moves spare play-money NEAR from named throwaway accounts under the 1108 root to the root, each keeping `keep` NEAR.
// TESTNET only. node sweep-some.mjs <keep NEAR> <account under the root> [...]
import { L, A } from './common.mjs';
const [keep, ...from] = process.argv.slice(2);
if (!(Number(keep) >= 0.05) || !from.length) { console.error('usage: sweep-some.mjs <keep NEAR> <account under the root>...'); process.exit(64); }
for (const f of from) {
  if (!f.endsWith(`.${A.owner}`) || [A.core, A.market, A.usdc].includes(f)) { console.error(`refusing ${f}`); continue; }
  const amt = Math.floor((await L.balanceRawNear(f) - Number(keep)) * 1000) / 1000;
  if (amt < 0.1) continue;
  const out = await (await L.acct(f)).sendMoney(A.owner, BigInt(Math.round(amt * 1e6)) * 10n ** 18n);
  L.append('txlog.jsonl', { step: `move ${amt} NEAR ${f} -> root (round 3)`, signer: f, contract: A.owner, method: 'Transfer', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
  console.log(`moved ${amt} NEAR from ${f} tx=${out.transaction.hash}`);
}
console.log('root', (await L.balanceRawNear(A.owner)).toFixed(3));
