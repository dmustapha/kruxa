// Funds the throwaway root from fresh testnet-helper accounts (play money): node fund-root.mjs <helper-account-id>... (each must end in .testnet).
// Each helper is created through POST https://helper.testnet.near.org/account with a fresh throwaway key (saved mode 600 under
// ~/.kruxa-secrets/instant-testnet/, never printed), then sends all but 0.5 NEAR to the root (KXI_ROOT, default kxi-root-1108.testnet). TESTNET only.
import { L, A } from './common.mjs';

const helpers = process.argv.slice(2);
if (!helpers.length || helpers.some((h) => !h.endsWith('.testnet'))) { console.error('usage: fund-root.mjs <helper>.testnet ...'); process.exit(64); }
for (const h of helpers) {
  if (!(await L.exists(h))) {
    const kp = L.newKey(h);
    const r = await fetch('https://helper.testnet.near.org/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: h, newAccountPublicKey: kp.getPublicKey().toString() }) });
    console.log(h, 'helper http', r.status);
    await L.sleep(4);
  }
  const bal = await L.balanceRawNear(h);
  if (bal < 1) { console.log(h, 'balance', bal, 'skip'); continue; }
  const amount = Math.floor((bal - 0.5) * 100) / 100;
  const out = await (await L.acct(h)).sendMoney(A.owner, BigInt(Math.round(amount * 1e6)) * 10n ** 18n);
  L.append('txlog.jsonl', { step: `fund root ${A.owner} from helper ${h} (${amount} NEAR)`, signer: h, contract: A.owner, method: 'Transfer', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
  console.log(`sent ${amount} NEAR from ${h} tx=${out.transaction.hash}`);
}
console.log('root balance', (await L.balanceRawNear(A.owner)).toFixed(3));
