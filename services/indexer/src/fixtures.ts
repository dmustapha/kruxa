import { cpOut } from "./price.ts";
import type { ContractSet, NearBlock } from "./types.ts";

/** Offline event fixture generator. Output is shaped like neardata blocks, so tests and the demo use the real parse path. */
export const FIXTURE_CONTRACTS: ContractSet = { core: ["core.fixture.testnet"], market: ["market.fixture.testnet"] };
export const FIXTURE_BASE_TIME = 1_800_000_000; // unix seconds, fixed so output is reproducible
export const FIXTURE_START_HEIGHT = 1000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Log = { contract: string; event: string; data: Record<string, unknown>; status?: unknown };

class Builder {
  blocks: NearBlock[] = [];
  private height = FIXTURE_START_HEIGHT;
  private prev = "fixture-genesis";
  private receipts = 0;

  /** Emit a block at `timeSec` holding the given events (one receipt each). */
  push(timeSec: number, logs: Log[]): void {
    const hash = `fixture-block-${this.height}`;
    const outcomes = logs.map((l) => ({
      execution_outcome: {
        id: `fixture-rcpt-${++this.receipts}`,
        outcome: {
          executor_id: l.contract,
          logs: [`EVENT_JSON:${JSON.stringify({ standard: "kruxa", version: "1.0.0", event: l.event, data: [l.data] })}`],
          status: l.status ?? { SuccessValue: "" },
        },
      },
    }));
    this.blocks.push({
      block: { header: { height: this.height, hash, prev_hash: this.prev, timestamp_nanosec: (BigInt(timeSec) * 1_000_000_000n).toString() } },
      shards: [{ shard_id: 0, receipt_execution_outcomes: outcomes }],
    });
    this.prev = hash;
    this.height += 2; // neardata skips heights; mimic that
  }
}

const core = FIXTURE_CONTRACTS.core[0] as string;
const market = FIXTURE_CONTRACTS.market[0] as string;
const ns = (sec: number): string => (BigInt(sec) * 1_000_000_000n).toString();

/** Three launches: A passes and trades, B fails, C is still open. `trades` swaps are generated for A. */
export function generateFixtureBlocks(seed = 7, trades = 240): NearBlock[] {
  const rnd = mulberry32(seed);
  const b = new Builder();
  let t = FIXTURE_BASE_TIME;
  const day = 86400;
  const cfg = { soft: "50000000", minFunders: 3 };
  const mkLaunch = (id: number, creator: string, sym: string, at: number, extra: Record<string, unknown> = {}): Log[] => [
    { contract: core, event: "charter_created", data: { launch_id: String(id), creator, symbol: sym, charter_hash: `ch${id}`.padEnd(64, "0"), soft_cap: cfg.soft, min_funders: cfg.minFunders, stream_days: 30, ...extra } },
    { contract: core, event: "trial_opened", data: { launch_id: String(id), opens_at: ns(at), commit_end: ns(at + 2 * day), walk_end: ns(at + 3 * day) } },
  ];
  b.push(t, mkLaunch(1, "alice.testnet", "ALPHA", t));
  b.push(t + 10, mkLaunch(2, "bob.testnet", "BRAVO", t));
  b.push(t + 3 * day, mkLaunch(3, "carol.testnet", "CHARLIE", t + 3 * day, { payout_recipient: "carol-treasury.testnet" }));
  const funded = contribute(b, rnd, 1, ["dan", "erin", "fay", "gus", "hal"], t + 100, 20_000_000, 1);
  b.push(t + 200, [{ contract: core, event: "walked", data: { launch_id: "1", holder: "near:hal.testnet", amount: "20000000", total_active: String(funded - 20_000_000), funders: 4, book_hash: "bk1w".padEnd(64, "0") } }]);
  contribute(b, rnd, 2, ["ivy", "jon"], t + 300, 5_000_000, 2);
  const settle = t + 3 * day + 60;
  b.push(settle, passLogs(1, funded - 20_000_000, 4));
  b.push(settle + 5, failLogs(2, 10_000_000, 2));
  b.push(settle + 20, [
    { contract: core, event: "tokens_claimed", data: { launch_id: "1", holder: "near:dan.testnet", amount: "4000000000" } },
    { contract: core, event: "tokens_claimed", data: { launch_id: "1", holder: "near:erin.testnet", amount: "4000000000" } },
    { contract: market, event: "pool_opened", data: { launch_id: "1", quote_reserve: "20000000", token_reserve: "1000000000000", fee_bps: 100, creator_bps: 5000, payout_recipient: "alice.testnet", token_decimals: 6, mint_authority: null, freeze_authority: null } },
  ]);
  tradeLoop(b, rnd, settle + 120, trades);
  const end = settle + 120 + trades * 45;
  b.push(end, [{ contract: market, event: "creator_claimed", data: { launch_id: "1", recipient: "alice.testnet", amount: "100000" } }]);
  b.push(end + 30, [{ contract: core, event: "payout_resolved", data: { launch_id: "1", kind: "Stream", amount: "250000", ok: true } }]);
  b.push(end + 60, [{ contract: core, event: "payout_resolved", data: { launch_id: "2", kind: "RefundNative", amount: "5000000", ok: false } }]);
  b.push(end + 90, [contribLog(3, "dan", 8_000_000, 8_000_000, 1)]);
  return b.blocks;
}

function contribLog(id: number, who: string, net: number, total: number, funders: number): Log {
  return { contract: core, event: "contributed", data: { launch_id: String(id), holder: `near:${who}.testnet`, net: String(net), relay_fee: "0", custody: "Native", total_active: String(total), funders, book_hash: `bk${id}-${funders}`.padEnd(64, "0") } };
}

function contribute(b: Builder, rnd: () => number, id: number, who: string[], at: number, unit: number, _salt: number): number {
  let total = 0;
  who.forEach((w, i) => {
    const net = unit + Math.floor(rnd() * 5) * 1_000_000;
    total += net;
    b.push(at + i * 20, [contribLog(id, w, net, total, i + 1)]);
  });
  return total;
}

function passLogs(id: number, total: number, funders: number): Log[] {
  return [
    { contract: core, event: "verdict", data: { launch_id: String(id), outcome: "PASS", inputs_hash: "in1".padEnd(64, "0"), total_active: String(total), funders } },
    { contract: core, event: "pass_allocated", data: { launch_id: String(id), accepted: String(total), launch_fee: "1500000", lp_quote: "20000000", stream: "9000000", excess_pool: "0" } },
  ];
}

function failLogs(id: number, total: number, funders: number): Log[] {
  return [{ contract: core, event: "verdict", data: { launch_id: String(id), outcome: "FAIL", reasons: ["below_soft_cap", "below_min_funders"], total_active: String(total), funders } }];
}

function tradeLoop(b: Builder, rnd: () => number, start: number, n: number): void {
  let qr = 20_000_000n;
  let tr = 1_000_000_000_000n;
  const traders = ["dan", "erin", "fay", "gus", "kim", "lee"].map((x) => `${x}.testnet`);
  for (let i = 0; i < n; i++) {
    const buy = rnd() < 0.55;
    const trader = traders[Math.floor(rnd() * traders.length)] as string;
    const size = BigInt(100_000 + Math.floor(rnd() * 900_000));
    const amountIn = buy ? size : (size * tr) / qr;
    const out = cpOut(buy ? qr : tr, buy ? tr : qr, amountIn, 100n);
    const feeTotal = buy ? amountIn / 100n : out / 99n;
    if (out === 0n) continue;
    if (buy) { qr += amountIn; tr -= out; } else { tr += amountIn; qr -= out; }
    const slice = (bp: bigint): string => ((feeTotal * bp) / 10_000n).toString();
    b.push(start + i * 45, [{ contract: market, event: "swap", data: {
      launch_id: "1", side: buy ? "buy" : "sell", trader, amount_in: amountIn.toString(), amount_out: out.toString(), fee_total: feeTotal.toString(),
      slices: { creator: slice(5000n), platform: slice(1500n), holders: slice(1500n), lp: slice(1000n), referral: slice(1000n) },
      quote_reserve: qr.toString(), token_reserve: tr.toString(),
    } }]);
  }
}
