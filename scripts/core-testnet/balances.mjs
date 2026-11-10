// Read-only: prints NEAR balance, code hash prefix and storage of the accounts given as argv (testnet only).
import * as L from '../instant-testnet/lib.mjs';
for (const n of process.argv.slice(2)) {
  try {
    const r = await (await L.net()).connection.provider.query({ request_type: 'view_account', finality: 'optimistic', account_id: n });
    console.log(n, (Number(BigInt(r.amount)) / 1e24).toFixed(3), 'NEAR', 'code', r.code_hash.slice(0, 8), 'storage', r.storage_usage);
  } catch (e) { console.log(n, 'ERR', String(e.message).slice(0, 60)); }
}
