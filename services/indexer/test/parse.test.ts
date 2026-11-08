import assert from "node:assert/strict";
import { test } from "node:test";
import { extractEvents, parseLogLine } from "../src/parse.ts";
import { FIXTURE_CONTRACTS } from "../src/fixtures.ts";
import { evLine, mkBlock } from "./helpers.ts";

test("parseLogLine accepts kruxa 1.0.0 and rejects look-alikes", () => {
  assert.equal(parseLogLine(evLine("swap", { launch_id: "1" })).length, 1);
  assert.equal(parseLogLine(evLine("swap", {}, "other")).length, 0);
  assert.equal(parseLogLine(evLine("swap", {}, "kruxa", "2.0.0")).length, 0);
  assert.equal(parseLogLine("EVENT_JSON:{not json").length, 0);
  assert.equal(parseLogLine("hello").length, 0);
});

test("extractEvents drops logs from unwatched contracts, wrong-kind events and failed receipts", () => {
  const core = "core.fixture.testnet";
  const market = "market.fixture.testnet";
  const b = mkBlock(1, "h1", "h0", 100, [
    { id: "r1", executor: core, line: evLine("verdict", { launch_id: "1" }) },
    { id: "r2", executor: "evil.testnet", line: evLine("verdict", { launch_id: "1" }) },
    { id: "r3", executor: core, line: evLine("swap", { launch_id: "1" }) },
    { id: "r4", executor: market, line: evLine("swap", { launch_id: "1" }) },
    { id: "r5", executor: core, line: evLine("verdict", { launch_id: "9" }), status: { Failure: { ActionError: {} } } },
  ]);
  const got = extractEvents(b, FIXTURE_CONTRACTS).map((e) => e.receiptId);
  assert.deepEqual(got, ["r1", "r4"]);
});
