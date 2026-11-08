// Funds the throwaway root from testnet helper accounts (play money). Usage: node fund.mjs
import { ROOT, exists, loadKey, newKey, acct, balanceNear, sleep, append, yocto } from './lib.mjs';
const TAG = ROOT.replace(/^kxi-root-/, '').replace(/\.testnet$/, '');
const helpers = ['a', 'b'].map((x) => `kxi-fund-${x}-${TAG}.testnet`);
for (const h of [ROOT, ...helpers]) {
  if (await exists(h)) { console.log(h, 'exists'); continue; }
  const kp = newKey(h);
  const r = await fetch('https://helper.testnet.near.org/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: h, newAccountPublicKey: kp.getPublicKey().toString() }) });
  console.log(h, 'helper http', r.status);
  await sleep(3);
}
for (const h of helpers) {
  await loadKey(h);
  const bal = await balanceNear(h);
  if (bal < 9.6) { console.log(h, 'balance', bal, 'skip'); continue; }
  const a = await acct(h);
  const out = await a.sendMoney(ROOT, BigInt(yocto(9.5)));
  append('txlog.jsonl', { step: `fund root from ${h} (9.5 NEAR)`, signer: h, contract: ROOT, method: 'Transfer', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
  console.log('funded root from', h, out.transaction.hash);
}
console.log('root balance', await balanceNear(ROOT));
