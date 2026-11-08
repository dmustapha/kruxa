# SWARM-OUTPUT: recorded crowd-test run (JSON)

Owner: workstream T1 (`tools/swarm-sim`). Consumer: the app's Create page, "Test your terms against a simulated crowd" (APP-SPEC section 6, P1: recorded and scripted; P2: live in-browser rerun).

Files: `swarm/runs/run-<seed>.json`, seeds 1 to 3, committed. Schema id `kruxa.swarm.run/1`. Regenerate with `make swarm-record`; `make swarm` fails if a committed file no longer reproduces byte for byte. The runs are deterministic: same seed, same bytes.

Conventions (same as the contracts' JSON):
- Every USDC amount is a decimal STRING of micro-USDC (6 decimals), never a JSON number. Token amounts are decimal strings of base units (6 decimals, so divide by 1e6 for whole tokens). `BigInt(s)` in the browser.
- Plain counts, basis points (`*_bps`, 10000 = 100 percent) and round numbers are JSON numbers.
- Signed margins are decimal strings (they can be negative).
- The label is mandatory in the UI: show `label` verbatim ("SCRIPTED, RECORDED"). Do not present a recorded run as a live test.

## Shape

```jsonc
{
  "schema": "kruxa.swarm.run/1",
  "seed": 2,
  "preset": "thin margin, soft cap near the crowd",   // seeds 1,2,3 are named presets
  "honest_budget_pct": 45,                              // crowd temperature
  "label": "SCRIPTED, RECORDED (offline simulation ...)",
  "trial": {
    "hard_cap": "1000000000", "soft_cap": "1000000000", "min_funders": 10, "min_buy": "20000000",
    "wallet_cap": "100000000", "max_total_held": "2000000000", "max_holders": 100, "n_sale": "600000000000000",
    "rounds": 24, "commit_end_round": 20, "walk_end_round": 24, "usdc_unit": "1000000"
  },
  "agents": [ // 16, fixed order: H1..H7, W1, W2, S1, S2, Y1..Y4, F
    { "index": 15, "id": "F", "label": "walk-flipper", "group": "flipper", "honest": false,
      "budget": "100000000", "peak_commit": "100000000", "final_commit": "0",
      "spend": "0", "refund": "0", "tokens": "0", "bonus_tokens": "0",
      "walked": true, "walked_round": 23,
      "refused": { "R_CAP_ACCOUNT": 4 } }   // rule code -> count of refused attempts
  ],
  "rounds": [ // 24, index = round number 0..23
    { "round": 23, "phase": "Closing",            // "Open" for rounds 0..19, "Closing" for 20..23
      "total_committed": "954000000", "funders": 13,
      "margin_usdc": "-46000000",                 // total_committed - soft_cap (signed)
      "margin_funders": 3,                         // funders - min_funders (signed)
      "verdict_now": "FAIL(BELOW_SOFT_CAP)",      // "PASS" or "FAIL(REASON|REASON)"
      "oversubscription_bps": 9540,                // total / hard cap
      "events": [ { "agent": 15, "action": "walk", "amount": "100000000", "result": "ok" } ],
                                                  // action "commit" | "walk"; result "ok" or a rule code
      "invariants_checked": 10,
      "violations": [] }                           // [{id, detail}], empty when green
  ],
  "settlement": {
    "verdict": "PASS", "passed": true,
    "total_committed": "1207000000", "funders": 15, "accepted": "1000000000",
    "launch_fee": "...", "lp_quote": "...", "stream": "...", "excess_refunded": "...",
    "oversubscription_bps": 12070,
    "margin_usdc": "607000000", "margin_funders": 5,
    "clearing_usdc_per_million_whole_tokens": "1.67"   // null on FAIL; same price for every buyer
  },
  "groups": [ // honest, whale, sniper, sybil, flipper
    { "group": "sybil", "agents": 4, "committed": "400000000", "spend": "...", "refund": "...", "tokens": "...",
      "commit_share_bps": 3314, "token_share_bps": 3314, "fill_bps": 8285 }   // fill = spend / committed
  ],
  "analysis": {
    "adversaries_beat_honest": false,        // true only on a price edge, a cap breach or an invariant violation
    "price_parity": true, "max_price_deviation_ppm": "0",
    "blocked_by_rule": [ { "group": "whale", "rule_code": "R_CAP_ACCOUNT", "count": 6 } ],
    "bounded_not_blocked": [
      { "attack": "sybil_split", "outcome": "BOUNDED", "ring_accounts": 4, "ring_committed": "400000000",
        "multiple_of_one_wallet_cap_x100": "400", "note": "..." },
      { "attack": "walk_flip", "outcome": "BOUNDED", "flip_succeeded": true,
        "margin_before_walk_usdc": "54000000", "note": "..." }   // margin null if the flipper did not walk
    ],
    "violations": []
  },
  "probes": [ { "what": "walk at walk_end", "result": "R_WALK_CLOSED" }, ... ],
  "invariants": { "ids": ["C1","C2","K1","K2","V1","A1","A2","A3","A4","T1"], "rounds_checked": 24,
                  "checks_run": 240, "violations": 0, "held": true }
}
```

## How the UI should read it

- Margin over time chart: plot `rounds[i].margin_usdc` (BigInt, divide by 1e6) against `round`; mark `commit_end_round` (commit closes) and `walk_end_round` (Walk closes). `verdict_now` colours the line.
- Outcome strip: `settlement.verdict`, `accepted`, `oversubscription_bps`, and the one-line rule: "everyone pays the same price: spend = your commit x accepted raise / total committed".
- Attack table: one row per attack, from `blocked_by_rule` (BLOCKED, with the rule code) and `bounded_not_blocked` (BOUNDED, never shown as blocked). Required honest wording: "Sybil splitting and walk-to-flip are bounded, not blocked."
- Agent table from `agents` (spend, refund, tokens, walked, refused).
- `invariants.held` drives the green "24 of 24 rounds, invariants held" badge. If `held` is false, show the violations and do not show a green badge.

## What the file does not claim

It is our own 16 scripted agents against the real `verdict`, `allocate` and `settle_position` functions on a synthetic clock. It is not a chain run, not model-driven, and not proof that no other strategy works. `make swarm-testnet` (the on-chain replay) is NOT implemented.
