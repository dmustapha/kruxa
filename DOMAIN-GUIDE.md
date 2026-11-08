# Domain Guide

**File type:** non-agent project, so `DOMAIN-GUIDE.md` (build generates it from this section). **Rules** it must carry: money is micro-USDC (6 decimals) everywhere; times are u64 ns; charged amounts round up, paid amounts round down; dust goes to the LP bucket, never to the creator or the platform; the verdict reads only four numbers and a flag; a rejection returns money, it never panics; exits stay open under PAUSED.

| Term | Definition | Code identifier | Source |
|---|---|---|---|
| Trial | the refundable period in which a launch is held back by a rule | `create_trial`, `Status::Open` | WINNER-BRIEF |
| Charter | immutable record of all terms, rules snapshot and windows; its borsh hash is `charter_hash` | `Charter`, `charter_hash` | S1-A 4 |
| Commit | USDC credited to a position during the Open phase | `try_commit`, event `contributed` | S1-B 5 |
| Walk | exit of the whole position before `walk_end`, principal returned in full, no fee | `walk`, `walk_signed`, event `walked` | S1-B 6 |
| Soft cap / hard cap | minimum total to PASS / total accepted at the clearing price | `soft_cap`, `hard_cap` | S1-B 2 |
| Oversubscription | `total_active > hard_cap`: everyone is scaled pro-rata and the excess is refunded with no fee | `Allocation.excess_pool` | S1-B 2.3 |
| Clearing price | `accepted / n_sale`, identical for every non-walked buyer | `allocate`, `settle_position` | S1-B 2.1 |
| Verdict | pure function PASS / FAIL(reasons bitset) | `verdict()`, `VerdictInputs` | S1-B 4 |
| inputs_hash | sha256 of the canonical little-endian encoding of the verdict inputs | `inputs_hash()` | verdict.rs |
| book_hash | rolling sha256 over every contributed and walked event; replayed by a judge | `book_next()` | S1-B 4.4 |
| Walk tail | the span between `commit_end` and `walk_end` in which the book can only shrink | `Phase::Closing` | S1-B 4.6 |
| Position | one holder's money and entitlements in one launch | `Position` | RECONCILED 3.1 |
| Custody | where a unit of principal physically sits: native USDC or inside `intents.near` | `Custody::{Native, Intents}` | RECONCILED 3.1 |
| Four buckets | launch fee, LP seed, stream, excess-refund pool; sum equals total committed | `Buckets` | RECONCILED 2.2 row 14 |
| Stream (lite) | creator proceeds unlocking linearly from PASS; withdraw-all reverts `STREAM_CAP` | `draw`, `linear_unlocked` | S1-C 4 |
| Relay fee | flat quoted USDC fee carved out of the signed amount that pays the submitter's gas; not principal, not refundable | `relay_fee` | RULING R2 |
| S3 / S4 | Intents attribution: buyer-signed transfer whose flat `msg` triggers `mt_on_transfer` (primary) / anyone forwards a signed memo transfer (fallback) | `mt_on_transfer`, `contribute_via_intents` | W0 |
| Deliver | where the tokens go: `near:<account>` or `sol:<key>` | `HolderId` | S1-B 5.1 |
| Bond | creator's refundable NEAR deposit that pays position storage | `bond_required` | RECONCILED 3.2 row 26 |
| Ladder caps | $1,000 per launch, $3,000 global, raising is timelocked 7 days | `Rules.max_hard_cap`, `Config.global_cap` | RULING 2026-11-07 |
| Pause / Freeze | stop new risk (exits open) / stop everything, auto-expires after 7 days | `PauseLevel` | S1-A 10.2 |

Source mapping: each row cites the spec section above; `build` copies definitions from `research/` and the specs, never invents them.

