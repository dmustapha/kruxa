import { id, call, tgas, append, N_TOTAL } from './lib.mjs';
const CD = id('creator-d');
for (const g of [85, 90, 95]) {
  const sym = `KXIQG${g}`;
  const r = await call(`create_token direct at ${g} Tgas (${sym})`, CD, 'token.primitives.testnet', 'create_token',
    { args: { owner_id: CD, total_supply: N_TOTAL.toString(), metadata: { spec: 'ft-1.0.0', name: sym, symbol: sym, decimals: 6 } } }, { deposit: '60000000000000000000000', gas: tgas(g), expectFail: g < 100 });
  append('findings.jsonl', { finding: 'real factory create_token minimum gas (refined)', prepaid_tgas: g, success: r.success, tx: r.tx });
  if (r.success) break;
}
