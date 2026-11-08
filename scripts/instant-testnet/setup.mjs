// Stage 1: accounts, contracts, wiring. DEMO PROFILE (10-second days): throwaway TESTNET accounts only, labelled demo-*.
import crypto from 'crypto';
import fs from 'fs';
import { ROOT, id, ensureAccount, deployWasm, call, snapshot, view, tgas, append, USDC } from './lib.mjs';

const W = (n) => new URL(`../../target/near/${n}/${n}.wasm`, import.meta.url).pathname;
const A = { owner: ROOT, guardian: id('guardian'), treasury: id('treasury'), usdc: id('usdc'), factory: id('factory'),
  launcher: id('demo-instant'), market: id('demo-market'), creatorA: id('creator-a'), creatorB: id('creator-b'), buyer: id('buyer') };
const spec = [['guardian', 0.15], ['treasury', 0.15], ['usdc', 1.9], ['factory', 6.7], ['demo-instant', 3.0], ['demo-market', 2.9], ['creator-a', 0.6], ['creator-b', 0.6], ['buyer', 0.5]];
for (const [n, f] of spec) await ensureAccount(id(n), ROOT, f);
const sha = (n) => crypto.createHash('sha256').update(fs.readFileSync(W(n))).digest('hex');
await deployWasm(A.usdc, W('mock_ft'), 'new', { owner_id: ROOT, total_supply: '0' });
await deployWasm(A.factory, W('mock_factory'), 'new', {});
await deployWasm(A.launcher, W('kruxa_instant_contract'), 'new', { owner: ROOT, guardian: A.guardian, treasury: A.treasury, usdc: A.usdc, factory: A.factory, profile: 'demo' });
await deployWasm(A.market, W('kruxa_market_contract'), 'new', { owner: ROOT, guardian: A.guardian, treasury: A.treasury, usdc: A.usdc, core: ROOT, max_pool_reserve_q: null, max_global_reserve_q: null, max_instant_reserve_q: null });
for (const who of [A.launcher, A.market, A.treasury, A.creatorA, A.creatorB, A.buyer, ROOT])
  await call(`register ${who} on mock USDC`, ROOT, A.usdc, 'storage_deposit', { account_id: who }, { deposit: '2000000000000000000000', gas: tgas(30) });
await call('market.set_launcher(launcher)', ROOT, A.market, 'set_launcher', { account: A.launcher }, { gas: tgas(30) });
await call('launcher.set_market(market)', ROOT, A.launcher, 'set_market', { account: A.market }, { gas: tgas(30) });
fs.writeFileSync(new URL('../../evidence/instant-testnet/accounts.json', import.meta.url).pathname, JSON.stringify({
  network: 'NEAR TESTNET (play money)', profile: 'demo (10-second days): throwaway demo accounts, never a public deployment', accounts: A,
  wasm_sha256: { launcher: sha('kruxa_instant_contract'), market: sha('kruxa_market_contract'), mock_ft: sha('mock_ft'), mock_factory: sha('mock_factory') } }, null, 2));
console.log(JSON.stringify(await view(A.launcher, 'get_config')).slice(0, 600));
await snapshot('after setup', A.launcher, A.market);
