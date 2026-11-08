import { id, call, sleep, tgas, balanceRawNear, append, N_TOTAL } from './lib.mjs';
const REAL = 'token.primitives.testnet', CD = id('creator-d');
await sleep(10);
const b0 = await balanceRawNear(CD);
const r = await call('H-01 isolated: create_token for an existing account, 0.06 NEAR attached, 150 Tgas', CD, REAL, 'create_token',
  { args: { owner_id: CD, total_supply: N_TOTAL.toString(), metadata: { spec: 'ft-1.0.0', name: 'dup', symbol: 'KXIPG100', decimals: 6 } } },
  { deposit: '60000000000000000000000', gas: tgas(150), expectFail: true });
await sleep(12);
const b1 = await balanceRawNear(CD);
append('findings.jsonl', { finding: 'H-01 isolated, real factory, existing token account', tx: r.tx, caller_balance_change_near: b1 - b0, deposit_attached_near: 0.06, reading: (b1 - b0) < -0.05 ? 'factory KEPT the 0.06 deposit on a failed batch' : 'deposit came back to the caller (only gas lost)' });
console.log('delta', b1 - b0);
