/** Tiny helper: core-call.ts CORE METHOD '{"json":"args"}' [--view]. Testnet only; signs as the relayer account. */
import { testnetAccount } from "./near.js";

const [core, method, raw = "{}"] = process.argv.slice(2);
if (!core || !method || !core.endsWith(".testnet")) { console.error("usage: core-call.ts CORE.testnet METHOD [JSON] [--view]"); process.exit(64); }
const acct = await testnetAccount();
if (process.argv.includes("--view")) {
  console.log(JSON.stringify(await acct.viewFunction({ contractId: core, methodName: method, args: JSON.parse(raw) })));
} else {
  const out = await acct.functionCall({ contractId: core, methodName: method, args: JSON.parse(raw), gas: 200n * 10n ** 12n, attachedDeposit: 0n });
  console.log(`tx ${out.transaction.hash} status ${JSON.stringify(out.status).slice(0, 200)}`);
}
