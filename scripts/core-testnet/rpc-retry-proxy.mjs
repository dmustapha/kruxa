// Local pass-through to the NEAR TESTNET RPC that waits and resends when the shared endpoint answers HTTP 429 (rate limited, request not processed).
// For tools that use plain fetch and cannot retry (genesis driver, verify.sh). Point them at it with NEAR_TESTNET_RPC / KRUXA_RPC.
//   node rpc-retry-proxy.mjs [port, default 18545]      upstream: KXI_RPC or https://test.rpc.fastnear.com (testnet only)
import http from 'http';
const UP = process.env.KXI_RPC || 'https://test.rpc.fastnear.com';
if (/mainnet|rpc\.mainnet/i.test(UP)) throw new Error('refusing: mainnet RPC');
const port = Number(process.argv[2] || 18545);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    let r, text;
    for (let i = 0; i < 12; i++) {
      r = await fetch(UP, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      text = await r.text();
      if (r.status !== 429) break;
      await sleep(3000 * (i + 1));
    }
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(text);
  });
}).listen(port, '127.0.0.1', () => console.log(`retry proxy on 127.0.0.1:${port} -> ${UP}`));
