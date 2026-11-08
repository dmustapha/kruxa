// Stage 4: direct probes of the REAL factory token.primitives.testnet (testnet, play money), with the exact create_token argument
// shape the launcher uses. Answers: minimum prepaid gas, registration of another account with 0.00125 NEAR, what ft_transfer returns
// (M-04), and what the factory does when the token account already exists (H-01).
import { ROOT, id, call, view, sleep, tgas, yocto, balanceRawNear, append, N_TOTAL, acct } from './lib.mjs';
const REAL = 'token.primitives.testnet';
const [CD, M] = [id('creator-d'), id('demo-market-real')];
const args = (sym, owner) => ({ args: { owner_id: owner, total_supply: N_TOTAL.toString(), metadata: { spec: 'ft-1.0.0', name: `${sym} probe`, symbol: sym, decimals: 6 } } });
const dep = '60000000000000000000000';
let made = null;
for (const g of [80, 100, 120, 150]) {
  const sym = `KXIPG${g}`;
  const r = await call(`create_token direct at ${g} Tgas (${sym})`, CD, REAL, 'create_token', args(sym, CD), { deposit: dep, gas: tgas(g), expectFail: g < 150 });
  append('findings.jsonl', { finding: 'real factory create_token minimum gas', prepaid_tgas: g, success: r.success, tx: r.tx, rule_or_error: r.failures || r.error, receipts: r.receipts });
  if (r.success) { made = `${sym.toLowerCase()}.${REAL}`; break; }
}
if (!made) { console.log('no gas level worked'); process.exit(2); }
await sleep(5);
const bounds = await view(made, 'storage_balance_bounds', {}).catch((e) => `no view: ${e.message.slice(0, 80)}`);
const reg = await call('register the market on the real token with 0.00125 NEAR', CD, made, 'storage_deposit', { account_id: M, registration_only: true }, { deposit: yocto(0.00125), gas: tgas(30) });
const bal = await view(made, 'storage_balance_of', { account_id: M });
append('findings.jsonl', { finding: 'CO-7 unknown 1: 0.00125 NEAR registration on a real factory token', token: made, storage_balance_bounds: bounds, register_tx: reg.tx, register_ok: reg.success, storage_balance_of_market: bal, receipts: reg.receipts });
const tr = await call('ft_transfer on the real token (M-04: does it return bytes?)', CD, made, 'ft_transfer', { receiver_id: M, amount: '1000' }, { deposit: '1', gas: tgas(30) });
append('findings.jsonl', { finding: 'M-04: return value of ft_transfer on the real factory token', token: made, tx: tr.tx, return_value: tr.value === undefined ? '(empty)' : tr.value, verdict: tr.value === undefined || tr.value === '' ? 'returns nothing: the market misread (max_len 0) does not trigger with this token' : 'RETURNS BYTES: the market would book every payout as failed' });
// H-01: the token account already exists
const b0 = await balanceRawNear(CD);
const dup = await call(`create_token for an existing account (${made})`, CD, REAL, 'create_token', args(made.split('.')[0].toUpperCase(), CD), { deposit: dep, gas: tgas(150), expectFail: true });
await sleep(6);
const b1 = await balanceRawNear(CD);
append('findings.jsonl', { finding: 'H-01: real factory with an existing token account', tx: dup.tx, success: dup.success, caller_balance_change_near: b1 - b0, receipts: dup.receipts, note: 'if the change is about -0.06 the factory KEPT the deposit although the call failed' });
console.log('done', made);
