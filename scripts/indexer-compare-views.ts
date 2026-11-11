// Read-only: compare the indexer's folded state with the live contract views.
//   node scripts/indexer-compare-views.ts <db> <network> <core|-> <market> <ids,..|-> <out.json> [launcher instantIds,..]
// Every number on the indexer side comes from the served API pages (the same functions that bake a snapshot); the chain side is
// JSON-RPC `query call_function` (a view, nothing is sent or signed). Prints one line per field: MATCH or MISMATCH.
import { writeFileSync } from "node:fs";
import { httpRpc } from "../services/indexer/src/rpc.ts";
import { Store } from "../services/indexer/src/store.ts";
import { createApp } from "../services/api/src/http.ts";
import { one } from "../services/api/src/common.ts";
import type { Ctx } from "../services/api/src/common.ts";

const RPC = process.env.KRUXA_RPC_URL ?? "https://test.rpc.fastnear.com";
const raw = httpRpc(RPC);
type Obj = Record<string, unknown>;
interface Check {
  scope: string;
  field: string;
  chain: unknown;
  indexer: unknown;
  match: boolean;
}

async function view(account: string, method: string, args: Obj): Promise<Obj | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = (await raw("query", { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") })) as { result?: number[]; error?: string };
      if (r.error) throw new Error(`${account}.${method}: ${r.error}`);
      return JSON.parse(Buffer.from(r.result ?? []).toString()) as Obj | null;
    } catch (err) {
      if (!String((err as Error).message).includes("429") || attempt >= 8) throw err;
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
  }
}

const ZERO_HASH = "0".repeat(64);
const same = (a: unknown, b: unknown): boolean => String(a) === String(b);

/** A launch with no contribution yet: the contract holds the all-zero genesis hash, the indexer has seen no book event ("" or null). */
const sameBook = (chain: unknown, indexer: unknown): boolean => same(chain, indexer) || (chain === ZERO_HASH && (indexer === "" || indexer === null));

/** The contract says "Passed", "Failed(3)", "Open" ...; the indexer says verdict PASS/FAIL or null while undecided. */
function verdictOf(status: string): string | null {
  if (status.startsWith("Passed")) return "PASS";
  if (status.startsWith("Failed")) return "FAIL";
  return null;
}

function compareLaunch(id: string, s: Obj, api: Obj, fold: Obj, out: Check[]): void {
  const vi = (api.verdict_inputs ?? {}) as Obj;
  const add = (field: string, chain: unknown, indexer: unknown, eq = same): void => void out.push({ scope: `core launch ${id}`, field, chain, indexer, match: eq(chain, indexer) });
  add("verdict (get_state.status)", verdictOf(String(s.status)), api.verdict);
  add("total_active", s.total_active, api.total_active);
  add("active_funders (funders)", s.active_funders, api.funders);
  add("charter_hash", s.charter_hash, api.charter_hash);
  add("book_hash (rolling, folded)", s.book_hash, vi.book_hash_folded, sameBook);
  add("payout_recipient", s.payout_recipient, api.payout_recipient);
  add("book_hash replayed from contributed/walked (fold_ok)", s.book_hash, fold.book_hash_recomputed, sameBook);
  add("book_mismatch_at", null, fold.book_mismatch_at);
}

function comparePool(id: string, p: Obj, row: Obj | undefined, out: Check[]): void {
  const add = (field: string, chain: unknown, indexer: unknown): void => void out.push({ scope: `market pool ${id}`, field, chain, indexer, match: same(chain, indexer) });
  add("pool open", p !== null, row !== undefined);
  if (p === null || !row) return;
  add("q (quote_reserve)", p.q, row.quote_reserve);
  add("t (token_reserve)", p.t, row.token_reserve);
  add("token", p.token, row.token);
  add("payout_recipient", p.payout_recipient, row.payout_recipient);
  add("mode", p.mode, row.mode);
  add("opened_at (opened_ns / 1e9)", String(BigInt(String(p.opened_ns)) / 1_000_000_000n), row.opened_at);
  add("paused (state != Open)", p.state !== "Open", Number(row.paused) === 1);
}

function compareInstant(id: string, v: Obj, api: Obj, inst: Obj | undefined, pool: Obj | null, out: Check[]): void {
  const add = (field: string, chain: unknown, indexer: unknown): void => void out.push({ scope: `instant launch ${id}`, field, chain, indexer, match: same(chain, indexer) });
  // the API calls an Open instant launch with a live pool "trading"; every other state keeps the contract's word
  const chainStatus = String(v.status).toLowerCase();
  add("status (Open with a pool is served as trading)", chainStatus === "open" && pool !== null ? "trading" : chainStatus, String(api.status).toLowerCase());
  add("mode", "instant", api.mode);
  add("creator", v.creator, api.creator);
  add("payout_recipient", v.payout_recipient, api.payout_recipient);
  add("symbol", v.symbol, api.symbol);
  add("charter_hash", v.charter_hash, api.charter_hash);
  add("total_supply", v.total_supply, (api.instant as Obj | null)?.total_supply);
  if (!inst) return void out.push({ scope: `instant launch ${id}`, field: "instants row", chain: "present", indexer: "missing", match: false });
  add("token", v.token, inst.token);
  add("creator_alloc (n_alloc)", v.n_alloc, inst.creator_alloc);
  add("pool_tokens (n_pool)", v.n_pool, inst.pool_tokens);
  add("cliff_days", v.cliff_days, inst.cliff_days);
  add("vest_days", v.vest_days, inst.vest_days);
  add("seed_q", v.seed_q, inst.seed_q);
  add("launch_fee", v.launch_fee, inst.launch_fee);
  add("alloc_claimed", v.alloc_claimed, inst.alloc_claimed);
  add("opened_at (opened_at_ns / 1e9)", v.opened_at_ns && v.opened_at_ns !== "0" ? String(BigInt(String(v.opened_at_ns)) / 1_000_000_000n) : null, inst.opened_at);
}

async function main(): Promise<void> {
  const [db, network, core, market, ids, outFile, launcher, instantIds] = process.argv.slice(2);
  if (!db || !network || !core || !market || !ids || !outFile) throw new Error("usage: indexer-compare-views.ts <db> <network> <core> <market> <ids,..> <out.json>");
  const store = new Store(db, { contracts: { core: core === "-" ? [] : [core], market: [market], launcher: launcher ? [launcher] : [] }, network });
  const ctx: Ctx = { store, startedAt: 0, maxLagBlocks: 0, now: () => Math.floor(Date.now() / 1000), tail: () => ({ headHeight: null, lastError: null }), dataSource: "snapshot", daySeconds: 86_400 };
  const app = createApp(ctx);
  const checks: Check[] = [];
  const chainOnly: Obj = {};
  for (const id of ids === "-" ? [] : ids.split(",")) {
    const s = await view(core, "get_state", { launch_id: id });
    const inv = await view(core, "get_invariants", { launch_id: id });
    const pool = await view(market, "get_pool", { launch_id: id });
    const api = app.handle(`/api/launch/${id}`, new URLSearchParams()).body as Obj;
    if (s === null) throw new Error(`launch ${id}: get_state returned null`);
    compareLaunch(id, s, api, one(store, "SELECT book_hash_recomputed, book_mismatch_at FROM launches WHERE launch_id = ?", Number(id)) ?? {}, checks);
    comparePool(id, pool as Obj, one(store, "SELECT * FROM pools WHERE launch_id = ?", Number(id)), checks);
    chainOnly[id] = { get_invariants_all_ok: inv?.all_ok, get_invariants: inv };
  }
  for (const id of launcher && instantIds ? instantIds.split(",") : []) {
    const v = await view(launcher, "get_instant", { launch_id: id });
    const pool = await view(market, "get_pool", { launch_id: id });
    const api = app.handle(`/api/launch/${id}`, new URLSearchParams()).body as Obj;
    compareInstant(id, v as Obj, api, one(store, "SELECT * FROM instants WHERE launch_id = ?", Number(id)), pool, checks);
    comparePool(id, pool as Obj, one(store, "SELECT * FROM pools WHERE launch_id = ?", Number(id)), checks);
    chainOnly[id] = { launcher_get_invariants: await view(launcher, "get_invariants", { launch_id: id }) };
  }
  const mInv = await view(market, "get_invariants", {});
  chainOnly.market = mInv;
  for (const c of checks) console.log(`${c.match ? "MATCH   " : "MISMATCH"} ${c.scope} :: ${c.field} chain=${JSON.stringify(c.chain)} indexer=${JSON.stringify(c.indexer)}`);
  const bad = checks.filter((c) => !c.match).length;
  console.log(`checks=${checks.length} mismatches=${bad} rpc=${RPC}`);
  writeFileSync(outFile, JSON.stringify({ rpc: RPC, core, market, checks, chain_invariants: chainOnly, mismatches: bad }, null, 2) + "\n");
  void app.close();
  store.close();
  if (bad > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
