import { Store } from "../src/store.ts";
import { FIXTURE_CONTRACTS, generateFixtureBlocks } from "../src/fixtures.ts";
import type { NearBlock } from "../src/types.ts";

export function fixtureStore(blocks: NearBlock[] = generateFixtureBlocks()): Store {
  const s = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  for (const b of blocks) s.ingestBlock(b, "fixture");
  return s;
}

export function rows(s: Store, sql: string, ...p: Array<string | number>): Array<Record<string, unknown>> {
  return s.db.prepare(sql).all(...p) as Array<Record<string, unknown>>;
}

export function mkBlock(height: number, hash: string, prev: string, time: number, logs: Array<{ id: string; executor: string; line: string; status?: unknown }>): NearBlock {
  return {
    block: { header: { height, hash, prev_hash: prev, timestamp_nanosec: (BigInt(time) * 1_000_000_000n).toString() } },
    shards: [{ receipt_execution_outcomes: logs.map((l) => ({ execution_outcome: { id: l.id, outcome: { executor_id: l.executor, logs: [l.line], status: l.status ?? { SuccessValue: "" } } } })) }],
  };
}

export function evLine(event: string, data: Record<string, unknown>, standard = "kruxa", version = "1.0.0"): string {
  return `EVENT_JSON:${JSON.stringify({ standard, version, event, data: [data] })}`;
}
