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

/** Collects timed log groups, sorts them by time (stable), then numbers blocks and receipts in that order. */
class Builder {
  private entries: Array<{ time: number; logs: Log[] }> = [];

  push(timeSec: number, logs: Log[]): void {
    this.entries.push({ time: timeSec, logs });
  }

  build(): NearBlock[] {
    const sorted = this.entries.map((e, i) => ({ e, i })).sort((x, y) => x.e.time - y.e.time || x.i - y.i).map((x) => x.e);
    let height = FIXTURE_START_HEIGHT;
    let prev = "fixture-genesis";
    let receipts = 0;
    return sorted.map(({ time, logs }) => {
      const hash = `fixture-block-${height}`;
      const outcomes = logs.map((l) => ({
        execution_outcome: {
          id: `fixture-rcpt-${++receipts}`,
          outcome: {
            executor_id: l.contract,
            logs: [`EVENT_JSON:${JSON.stringify({ standard: "kruxa", version: "1.0.0", event: l.event, data: [l.data] })}`],
            status: l.status ?? { SuccessValue: "" },
          },
        },
      }));
      const block: NearBlock = {
        block: { header: { height, hash, prev_hash: prev, timestamp_nanosec: (BigInt(time) * 1_000_000_000n).toString() } },
        shards: [{ shard_id: 0, receipt_execution_outcomes: outcomes }],
      };
      prev = hash;
      height += 2; // neardata skips heights; mimic that
      return block;
    });
  }
}

const core = FIXTURE_CONTRACTS.core[0] as string;
const market = FIXTURE_CONTRACTS.market[0] as string;
const ns = (sec: number): string => (BigInt(sec) * 1_000_000_000n).toString();
const TERMS = {
  total_fee_bps: 100, creator_bps: 5000, platform_bps: 1500, holders_bps: 1500, lp_bps: 1000, referral_bps: 1000,
  opening_fee_start_bps: 500, opening_decay_minutes: 60, fee_vest_bps: 5000, fee_vest_days: 90,
};
const TOTAL_SUPPLY = "2000000000000";

/**
 * Four launches: ALPHA passes, has a Solana genesis and trades; BRAVO fails and refunds every backer (one payout retried);
 * CHARLIE is still open; DELTA passes with genesis pending and no pool. `trades` swaps are generated for ALPHA.
 */
export function generateFixtureBlocks(seed = 7, trades = 240): NearBlock[] {
  const rnd = mulberry32(seed);
  const b = new Builder();
  const t = FIXTURE_BASE_TIME;
  const day = 86400;
  const mk = (id: number, creator: string, sym: string, name: string, at: number, extra: Record<string, unknown> = {}): Log[] => [
    { contract: core, event: "charter_created", data: { launch_id: String(id), creator, symbol: sym, name, charter_hash: `ch${id}`.padEnd(64, "0"), soft_cap: "50000000", min_funders: 3, stream_days: 30, total_supply: TOTAL_SUPPLY, ...extra } },
    { contract: core, event: "trial_opened", data: { launch_id: String(id), opens_at: ns(at), commit_end: ns(at + 2 * day), walk_end: ns(at + 3 * day) } },
  ];
  b.push(t, mk(1, "alice.testnet", "ALPHA", "Alpha Coin", t));
  b.push(t + 10, mk(2, "bob.testnet", "BRAVO", "Bravo Cat", t + 10));
  b.push(t + 60, mk(4, "dora.testnet", "DELTA", "Delta Fox", t + 60));
  b.push(t + 500, [{ contract: core, event: "paused", data: { by: "owner.testnet" } }]);
  b.push(t + 520, [{ contract: core, event: "unpaused", data: {} }]);
  b.push(t + 540, [{ contract: core, event: "global_cap_queued", data: { value: "6000000000", effective_at: ns(t + 540 + 7 * day) } }]);
  const alpha = contribute(b, rnd, 1, ["dan", "erin", "fay", "gus", "hal"], t + 100, 20_000_000);
  const halNet = alpha[4] as number;
  const alphaTotal = sum(alpha) - halNet;
  b.push(t + 200, [{ contract: core, event: "walked", data: { launch_id: "1", holder: "near:hal.testnet", amount: String(halNet), total_active: String(alphaTotal), funders: 4, book_hash: "bk1w".padEnd(64, "0") } }]);
  const bravo = contribute(b, rnd, 2, ["ivy", "jon"], t + 300, 5_000_000);
  const delta = contribute(b, rnd, 4, ["kim", "lee", "max"], t + 400, 20_000_000);
  const settle = t + 3 * day + 60;
  b.push(settle, passLogs(1, alphaTotal, 4));
  b.push(settle + 5, failLogs(2, sum(bravo), 2));
  b.push(settle + 6, passLogs(4, sum(delta), 3));
  refunds(b, settle + 30, bravo);
  b.push(settle + 10, genesisLogs());
  b.push(settle + 20, [
    { contract: core, event: "tokens_claimed", data: { launch_id: "1", holder: "near:dan.testnet", amount: "4000000000" } },
    { contract: core, event: "tokens_claimed", data: { launch_id: "1", holder: "near:erin.testnet", amount: "4000000000" } },
    poolOpened(settle + 20),
  ]);
  b.push(settle + 60, [{ contract: market, event: "market_paused", data: { paused: true, by: "guardian.testnet" } }]);
  b.push(settle + 80, [{ contract: market, event: "market_paused", data: { paused: false, by: "owner.testnet" } }]);
  b.push(settle + 200, mk(3, "carol.testnet", "CHARLIE", "Charlie Dog", settle + 200, { payout_recipient: "carol-treasury.testnet" }));
  tradeLoop(b, rnd, settle + 120, trades);
  const end = settle + 120 + trades * 45;
  b.push(end, [{ contract: market, event: "creator_claimed", data: { launch_id: "1", recipient: "alice.testnet", amount: "100000", paid_creator: "100000" } }]);
  b.push(end + 20, [{ contract: market, event: "platform_withdrawn", data: { to: "treasury.testnet", amount: "50000" } }]);
  b.push(end + 30, [{ contract: core, event: "payout_resolved", data: { launch_id: "1", kind: "Stream", amount: "250000", ok: true } }]);
  b.push(end + 90, [contribLog(3, "dan", 8_000_000, 8_000_000, 1)]);
  return b.build();
}

function sum(xs: number[]): number {
  return xs.reduce((a, x) => a + x, 0);
}

function contribLog(id: number, who: string, net: number, total: number, funders: number): Log {
  return { contract: core, event: "contributed", data: { launch_id: String(id), holder: `near:${who}.testnet`, net: String(net), relay_fee: "0", custody: "Native", total_active: String(total), funders, book_hash: `bk${id}-${funders}`.padEnd(64, "0") } };
}

/** Contributions one after another; returns each backer's net so callers can walk or refund exactly. */
function contribute(b: Builder, rnd: () => number, id: number, who: string[], at: number, unit: number): number[] {
  const nets: number[] = [];
  let total = 0;
  who.forEach((w, i) => {
    const net = unit + Math.floor(rnd() * 5) * 1_000_000;
    total += net;
    nets.push(net);
    b.push(at + i * 20, [contribLog(id, w, net, total, i + 1)]);
  });
  return nets;
}

function passLogs(id: number, total: number, funders: number): Log[] {
  return [
    { contract: core, event: "verdict", data: { launch_id: String(id), outcome: "PASS", inputs_hash: `in${id}`.padEnd(64, "0"), total_active: String(total), funders } },
    { contract: core, event: "pass_allocated", data: { launch_id: String(id), accepted: String(total), launch_fee: "1500000", lp_quote: "20000000", stream: "9000000", excess_pool: "0" } },
  ];
}

function failLogs(id: number, total: number, funders: number): Log[] {
  return [{ contract: core, event: "verdict", data: { launch_id: String(id), outcome: "FAIL", reasons: ["below_soft_cap", "below_min_funders"], total_active: String(total), funders } }];
}

/** FAIL path: the first refund payout fails once and is retried, then the launch dissolves and the bond is reclaimed. */
function refunds(b: Builder, at: number, nets: number[]): void {
  const payout = (amount: number, ok: boolean): Log => ({ contract: core, event: "payout_resolved", data: { launch_id: "2", kind: "RefundNative", amount: String(amount), ok } });
  b.push(at, [payout(nets[0] as number, false)]);
  b.push(at + 30, [payout(nets[0] as number, true), payout(nets[1] as number, true)]);
  b.push(at + 60, [{ contract: core, event: "dissolved", data: { launch_id: "2" } }]);
  b.push(at + 61, [{ contract: core, event: "bond_reclaimed", data: { launch_id: "2", amount: "5000000000000000000000" } }]);
}

function genesisLogs(): Log[] {
  return [
    { contract: core, event: "genesis_committed", data: { launch_id: "1", network: "solana-devnet", path: "F1", spec_hash: "5pec".padEnd(64, "0") } },
    { contract: core, event: "genesis_confirmed", data: { launch_id: "1", mint: "FixtureMint11111111111111111111111111111111", tx_create: "FixtureTxCreate", tx_authority: "FixtureTxAuthority",
      distributor: "FixtureDistributor1111111111111111111111111", root: "r00t".padEnd(64, "0"), mint_authority: null, freeze_authority: null, verified_checks: ["mint_owned_by_token_program", "authorities_null"] } },
  ];
}

function poolOpened(at: number): Log {
  return { contract: market, event: "pool_opened", data: {
    launch_id: "1", token: "alpha.token.fixture.testnet", quote: "usdc.fixture.testnet", q: "20000000", t: "1000000000000", payout_recipient: "alice.testnet",
    opened_ns: ns(at), fee_bps: 100, creator_bps: 5000, mint_authority: null, freeze_authority: null, terms: TERMS, total_supply: TOTAL_SUPPLY,
  } };
}

/** Swaps follow MARKET-ABI M-A: holders and referral slices are 0 and show up as red_holders and red_referral inside lp. */
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
    if (out === 0n) continue;
    const gross = buy ? amountIn : (out * 10_000n) / 9_900n;
    const feeTotal = gross / 100n;
    const creator = (feeTotal * 5000n) / 10_000n;
    const platform = (feeTotal * 1500n) / 10_000n;
    const lp = feeTotal - creator - platform;
    if (buy) { qr += amountIn - creator - platform; tr -= out; } else { tr += amountIn; qr -= out + creator + platform; }
    b.push(start + i * 45, [{ contract: market, event: "swap", data: {
      launch_id: "1", side: buy ? "buy" : "sell", trader, receiver: trader, amount_in: amountIn.toString(), amount_out: out.toString(), fee_total: feeTotal.toString(),
      fee_bps: "100", creator_bps: 5000, creator: creator.toString(), platform: platform.toString(), holders: "0", lp: lp.toString(), referral: "0",
      surcharge: "0", red_holders: ((feeTotal * 1500n) / 10_000n).toString(), red_referral: ((feeTotal * 1000n) / 10_000n).toString(),
      q: qr.toString(), t: tr.toString(), ts_ns: ns(start + i * 45),
    } }]);
  }
}
