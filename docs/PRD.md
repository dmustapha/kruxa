# Kruxa: Product Requirements Document

**Hackathon:** NEAR HACKATHON: Build Beyond Boundaries (brief: `~/.claude/skills/hackathon-briefs/near.md`)
**Tracks (CHANGE-ORDER-3):** the `tracks` array is multi-track and built by the freeze-time rule in section 1.6 (target, six: memecoins, security, open, defi, swarms, agents; plus thesis as a conditional seventh (CHANGE-ORDER-4, credentials by Nov 9 18:00 UTC, dropped at Nov 10 12:00 UTC if the freshness check or JWT fails); stretch: nfts, business; dropped: privacy, realworld, games, social). The preferred track on the form is Dami's choice at submission (recommendation memecoins [ASSUMED]).
**Deadline:** 2026-11-14 23:59 UTC (7 days remaining on 2026-11-07). Feature freeze Nov 12. Repo public and X demo post Nov 13. Submit Nov 14, ONE shot, un-editable.
**Version:** V1.1 (forge Phase 1, written 2026-11-07; amended by CHANGE-ORDER-3 and CHANGE-ORDER-4 on 2026-11-08, synced by CHANGE-ORDER-5 on 2026-11-08)
**Run profile:** CAMPAIGN (hand-driven, no conductor)
**Companion documents:** `CHANGE-ORDER-5.md` (doc-sync of the 2026-11-08 deliberations and the six tracks), `DELIBERATION-LEDGER.md` (rulings R-xx), `CHANGE-ORDER-4.md` (track depth), `CHANGE-ORDER-3.md` (what changed on 2026-11-08 and why), `INVARIANTS.md` (build law), `USER-ONBOARDING.md` (section 7.4b), `ROUTE-ARCHITECTURE.md` (section 7.4c), `phases/W1-SCOPE-KICKOFF.md` (Wave 1 scope, 10 parts)

**Tags used in this document:** [VERIFIED: source] read or measured; [PROVEN: signed test] passed on mainnet in the signed-test kit; [ASSUMED] our working assumption, not confirmed; [UNVERIFIED] not confirmed by anything we have run; [OPEN] a decision or fact still missing, listed in section 9; [RULED] decided by Dami (DECISIONS-PACK1 rulings of 2026-11-06 and 2026-11-07).

**Hard constraints that bind every step in this document:**
1. Sign nothing, spend nothing, deploy nothing to mainnet, post nothing, push nothing, make no repo public and submit nothing without Dami's per-action confirmation.
2. No token or mint of any kind on mainnet before the brand token ($KRUXA) launches; mainnet token creation starts with $KRUXA. Mainnet is the product target; NEAR testnet and Solana devnet are rehearsal only, plus the no-funds judge verification path. Until $KRUXA, mainnet use is plumbing tests only, and the mainnet core refuses `create_trial` from any account but the owner (rule `R_CREATOR_GATE`, CHANGE-ORDER-3 section 13).
3. Every rehearsal runs on NEAR testnet and Solana devnet.
4. The platform never pays a buyer's gas. Buyers pay a quoted flat relay fee, or submit the call themselves.

---

## 1. Project Overview

### 1.1 One-Liner
Kruxa is a launch platform for NEAR and Solana where every token launch is a refundable trial: buyers can walk away before a deterministic verdict, the token only comes into existence on Solana if the trial passes, and the creator can only draw proceeds at a capped rate.

[README-HEADLINE: DEFERRED. Dami deferred the README headline wording (DECISIONS-PACK1 #17). This document does not finalize it. Any headline must carry the creator-maximum qualifier in section 1.4 and the honesty rules in INVARIANTS.md.]

### 1.2 Problem Statement
The default outcome of a token launch is loss. From `research/launchpad-deep-research.md` (as quoted in WINNER-BRIEF): only 0.63% of 655,770 tokens launched in one month of September 2025 graduated; 84.13% of 41,470 migrated tokens were high-risk; Solidus Labs classed about 98.6% of pump.fun tokens as rugs or pump-and-dumps (a vendor report, self-reported). Bundled accounts held 36.5% of supply at migration.

**The one number we use: 0.63% of launched tokens graduate, and between 76% and 98% are classed as failed, dumped or rugged** (the 98.6% figure is vendor-reported, so we quote the range, not the top of it).

The buyer has no way out before the outcome is known and no proof of what the creator can take. On NEAR, the official launchpad (meme.cooking) has no walk right and is NEAR-only; Tripwire is NEAR-only; neither ties a second chain's existence to a verdict (`warroom/gap-map.md` O8, W1, W2, M3). A newer rival, Calyx (an Aurora launchpad on NEAR Intents), was found in the vision round and is a direct competitor to watch [VERIFIED: PRODUCT-VISION-V2 section 3].

### 1.3 Solution
Kruxa is a real production platform, not a demo. The launchpad is one module. The trust core is called Earnest, and it works like this:

1. **Refundable trial.** A creator picks a preset and opens a trial with a time window, a soft cap, a hard cap and a minimum number of backers. Buyers commit USDC (from NEAR directly, or from Solana through NEAR Intents).
2. **Walk.** Until the trial's walk deadline, any buyer can leave and gets the whole principal back to their own account. The only things not returned are a flat relay fee for Solana-origin buyers who asked someone else to submit their call (it is quoted before they sign) and any Intents fee they choose to pay later to move funds to a Solana wallet.
3. **Deterministic verdict.** After the deadline, anyone calls `settle`. The result depends only on three numbers (total active commits, active backers, whether the creator cancelled), so anyone can recompute it.
4. **Solana genesis only after PASS.** On PASS, one genesis ceremony creates the Solana mint with mint and freeze authority set to None in the same session. On FAIL the Solana address never becomes a mint and everyone is refunded.
5. **Capped creator stream.** The creator draws nothing during the trial. After PASS the proceeds stream out at a fixed rate. A "withdraw all" call reverts with `STREAM_CAP`.
6. **Compounding record (roadmap).** Every settled trial writes a creator record, a backer record and a verdict record. These feed Earned Terms, Standing Orders and a Verdict Rail attestation that any Solana app can read (AMEND-1 thesis).
7. **Market (CO-3, pulled forward).** After PASS the token trades in Kruxa's own capped constant-product pool on NEAR (`market.kruxa.near`, "Market-lite", C5) with a fee router that pays the creator slice to the payout recipient. The Solana venue is Meteora: a DAMM v2 pool with locked LP (devnet spike first), Meteora DBC only after four checks pass (C17).

The honest status of novelty: no single component is new. Each is an unoccupied application of a known mechanism (a dominant assurance contract, a refundable crowdfund, an attestation registry). We do not claim "first" or "novel" anywhere (lesson of 2026-11-06).

### 1.4 The creator maximum, stated honestly
The contract caps the **declared** creator slice at 1.00% of trading volume (total fee at most 2.00%, creator share at most 60%, and the exact integer check `total_fee_bps x creator_bps <= 1,000,000`). That is not the same as "the creator can take at most 1%". Creator-controlled wallets that stake in the Hold Vault or act as referrers can capture parts of the holder slice (up to 30%) and referral slice (up to 20%). The hard bound on everything a creator-controlled set of wallets can extract is 80% of the fee, which is 1.60% of volume at the 2.00% maximum fee (S1-C section 9.1, decision 12 / DECISIONS-PACK1 #17 candidate text). Wash trading still loses the creator at least 20% of the fees paid. The unqualified sentence "the creator takes at most 1.00% of volume" is FORBIDDEN (INVARIANTS.md MUST NOT CLAIM). The fee layer now ships pre-freeze as Market-lite (C5, scope M-A, CHANGE-ORDER-3); Hold Vault, referral lots and ratchets stay in Wave 6b. The default fee split is NOT ruled (DN-15): the planned 35/20/20/15/10 and the recommended raise of the creator share are in section 4b.

### 1.5 Hackathon framing and the Genesis Round
- Kruxa is also Dami's real product. The first mainnet token launch is Dami's own brand token, $KRUXA [RULED 2026-11-06, ticker RULED 2026-11-07].
- **Genesis Round [RULED 2026-11-07]:** a capped, labelled launch of $KRUXA on mainnet, run through Kruxa's own trial, behind a go/no-go on **Nov 10 EOD** (moved from Nov 11 by R-GATE-MOVE, 2026-11-08; it stays a real check and is never skipped). The review gap (no independent audit before real user funds) is disclosed. If the hard rows of section 9.3 are not green on Nov 10 EOD, the launch moves past the hackathon and the submission stands on testnet/devnet rehearsals plus recorded mainnet plumbing receipts.
- Caps [RULED]: $1,000 per launch and $3,000 global, denominated in USDC, raising them is timelocked.
- Token route [RULED]: factory token (`token.primitives.near`) is the default for every launch including $KRUXA. The own-FT burn (10-20 NEAR) is NOT approved. The `TokenProvider` trait is still built so an own-FT route can be added later.
- The hackathon forces a public repo and a judged X post by Nov 13, so the project becomes public before any announcement schedule Dami had planned [VERIFIED: DECISIONS-PACK1 note on 2026-11-06].
- Preferred track on the form is Dami's choice at submission. Recommendation: memecoins (density 4 on the roster, so the least crowded fit, per `research/launchpad-track-angles.md`) [ASSUMED].
- **Mainnet is the product target [RULED R-NETS 2026-11-08].** Testnet and devnet are rehearsal plus the no-funds judge path (an AI judge runs the README verbatim without spending). Testnet-only stays eligible for every track (Q-010).
- **Must happen before Nov 14 [RULED R-MUST-HAPPEN]:** (a) the capped $KRUXA Genesis Round on mainnet ($1,000 per launch, $3,000 global, USDC, raise timelocked, review gap disclosed); (b) mainnet opened to third-party creators as a capped beta AFTER $KRUXA genesis succeeds ("succeeds" = settle PASS, Solana genesis confirmed, `verify.sh` exit 0 on the mainnet launch). The beta also needs a 2-of-3 Squads vault with two named independent signers (BLOCKER BLK-1, section 9.4; third-party creators only, not the Genesis Round). Dami named the rule himself: "id name 2 friends when we get there" (R-47, DN-21 [RULED 2026-11-08]). The signers are needed before third-party creators open on mainnet and NOT for the Genesis Round. The plan's latest date for naming them is Nov 11 EOD (verified Nov 12, B-gate) [ASSUMED]; Dami has not set a firmer date (ledger O-01). The fallback if they stay unnamed is a closed beta with testnet open to all.
- **Genesis control [RULED R-F0F1]:** F0 (the NEAR contract signs the Solana genesis through `v1.signer`) is primary, F1 (one-time relayer genesis, authorities nulled) is the fallback if F0 is not clean in rehearsal by the Nov 10 gate. **Timelock [RULED R-GR-TIME]:** the 48 h Squads timelock is kept; date math and what lands after Nov 14 are in section 8.3 and CHANGE-ORDER-3 section 4.
- **Caps and beta access [RULED DN-18/19, 2026-11-08, "go with your recommendation for the others"]:** the beta is open to any NEAR account under the same $1,000 and $3,000 caps, but only after the signer question (BLK-1) is settled; raising them is timelocked (7 days) and waits for independent review. Market reserve caps (DN-17) are separate: $5,000 per pool and $15,000 global, adopted as interim [RULED interim].

### 1.6 Track mapping (13 tracks, multi-track, honest) [CO-3]
Official rule (`research/raw/hackathon-a.md`, "Tracks" and the submission fields): the `tracks` array takes one or more ids, still one submission per project. Only the NEAR integration built in the window is judged (Q-002), so Solana-side work (Meteora, Squads) helps the product, not the score. Testnet-only is eligible for every track (Q-010). Dami's direction (R-TRACKS, 2026-11-08): go deep on the other modules so the one submission is eligible for several tracks. The ceiling is honesty: a track id goes into the `tracks` array ONLY if its judge-runnable step ran green at the Nov 12 freeze (rule F-TRACK below). A claim the plan cannot back is marked DROPPED with the reason.

Tiers: **A** = near-free by-products of the core. **B** = one small module that must run green at freeze. **C** = stretch, first to be cut, default NOT listed. **DROPPED** = no honest module. "Fit" is the author's judgment against the track prompt in `research/raw/prompts/` [ASSUMED]. Effort is incremental agent-days on top of the shared modules (Market-lite 2.0, indexer 1.0, wallets 0.5 and so on are counted once in section 8.3).

| Track | Tier | Fit | Minimal load-bearing module | Judge step (do X, see Y) | Honest limit | Effort | Depends on | Freeze rule |
|---|---|---|---|---|---|---|---|---|
| defi | B | medium | Market-lite (C5) with fee router; C4 Intents intake; signed Test 1 (DAMI RUNS); funds-in-motion strip with all seven 1Click statuses; F0 Chain Signatures evidence only as scoped (CO-4 section 8) | `scripts/intents-dry-quote.sh` prints HTTP 201; `make market-demo` prints `SLICES OK`; `/proof` strip | Intents has no testnet; a new token has no Intents quote; Test 1 may fail (then Solana-landing claims dropped); not a DCA vault; Market-lite unreviewed | 0.60 | WS-M, WS-I, Test 1 (Dami) | List only if dry quote 201 and `SLICES OK` |
| thesis | B (promoted by CO-4, conditional) | medium | `thesis/` pack: BigQuery SQL, Intents Explorer pull, committed snapshots, dashboard, THESIS.md with evidence against (CO-4 section 11) | `make thesis` prints a sha256 per chart and `THESIS BUILD OK` | BigQuery freshness [UNVERIFIED] (NEAR Lake deprecated 2026-03-24); Explorer needs a JWT; correlation is not causation | 1.00 | Dami: GCP, JWT by Nov 9 18:00 | List only if snapshots committed, `make thesis` green, evidence-against present by Nov 12 20:00; dropped at Nov 10 12:00 if freshness or JWT fails |
| privacy | DROPPED | none | none | none | Nothing in Kruxa is private: commits, positions and verdicts are public by design. Confidential Intents is invite-only [VERIFIED: concerns-snapshot]. A TEE summarizer would be decoration (concern PH3) | 0 | none | Never listed |
| business | C | weak | Not promoted (CO-4 section 12): the agent cannot buy its own inference autonomously (credits are bought in a dashboard) | none | Deterministic automation, no LLM decision | 0.6 if revisited | spare capacity after M-gate | Default NOT listed |
| swarms | B | medium | `tools/swarm-sim`: 20 agents (7 scripted, 4 model-driven, 9 adversaries: snipers, whales, sybil ring, walk-flipper), 24 rounds, invariants asserted every round, testnet sub-accounts (CO-4 section 7) | `make swarm` prints 24 `INV OK` lines, a scoreboard and `SWARM GREEN`; `make swarm-testnet` prints tx count | Sybil splitting and walk-to-flip are not blocked, only bounded (disclosed); pooled uniform price, not sealed-bid; no sellers; adversaries are our own | 1.00 | kruxa-logic, agentkit, core on testnet | List only if `make swarm` exits 0 with 24 of 24 invariant lines |
| security | A | strong | `verify.sh` tamper; Launch Check API; guard; agent vault (function-call key scoped to the vault); 100-attack sandbox gallery with rule codes and sandbox tx hashes; measured prompt-injection block rate (CO-4 section 6) | `./verify.sh 1 --tamper-all` exits 2; `make attack-gallery` prints `GALLERY 13/13 blocked or bounded`; `make guard-demo` prints BLOCKED; `make inject-report` | Signals are Kruxa's own facts, no external threat intelligence; guard is a client gate, the vault is the on-chain gate; vault unreviewed and testnet only | 1.20 + shared | C11, indexer, X1, X2 | List if tamper exits 2, at least 11 of 13 attacks show a rule code and none unexpectedly succeeds, guard-demo BLOCKED |
| agents | B | medium | Backer agent: decisions from `Qwen/Qwen3.8-27B` on NEAR AI Cloud (TEE-signed), hard policy (budget, Launch Check allow and `verify.sh --scope open` exit 0, forced walk trigger) enforced on chain by the agent vault; hash-chained signed receipts with every tx hash; MCP, `llms.txt`, OpenAPI (CO-4 section 5) | `make receipts-verify` prints `RECEIPTS OK level=L1`; `make agent-demo` prints `AGENT DEMO GREEN`; `make tee-attest` | Testnet USDC only; no hiring, no x402 earnings; negotiation only if the counter-offer ran; TEE level printed (L0/L1/L2), live signature [UNVERIFIED] until a key run | 1.05 + shared | X1, X2, core on testnet, Dami: NEAR AI key by Nov 9 12:00 | List only if receipts.json has at least 6 real testnet tx hashes, one V_ rejection, and receipts-verify green |
| realworld | DROPPED | none | none | none | A capped creator stream is not payroll, invoicing or a merchant rail for a real business. A token-less refundable pledge preset would need a core change and is a different product. Padding it would violate PH3. The creator-desk CSV export ships as a product feature without a track claim | 0 | none | Never listed (re-open after the hackathon) |
| games | DROPPED | none | none | none | No game loop, no NPC, no player economy exists or is planned before the freeze | 0 | none | Never listed |
| nfts | C | weak to medium | Survivor Pass: a non-transferable NEP-171 credential minted to a backer after a PASS by a permissionless method that cross-checks `get_position` and the verdict on core; gated `/pass` page and per-NFT history | after a testnet PASS, `make pass-demo` mints a pass to a backer and prints the gate check (holder 200, non-holder 403) | A credential with gating only: no royalties, no sub-account wallet, so "an NFT that does something" is thin | 1.0 | new `contracts/pass`, a settled PASS launch | Default NOT listed. Listed only if the demo is green and the transfer-refusal tests pass |
| memecoins | A | medium | Verdict-gated existence, capped stream, Market-lite opening-fee decay (surcharge to LP) and fee epochs, 60-day supply and fee simulation, token-page mechanics panel (CO-4 section 9) | `make sim` prints three tables, `BOUND OK`, `SIM sha256`; `make market-demo` shows two different `fee_bps_applied` | Supply is fixed (no reactive emission); no admin key claim impossible (upgrade key, pause disclosed); no sybil resistance | 0.80 | core, Market M, DN-26 | List if `make sim` exits 0 with `BOUND OK`; opening-fee sentence only if two fee values shown on testnet [SYNC 2026-11-10: `make sim` output is in `evidence/sim.txt` (three scenario tables, `BOUND OK`, `SIM sha256`) and `make market-demo` in `evidence/market.txt` (`fee_bps_applied=500` then `=100`); both match this row] |
| social | DROPPED (re-openable) | weak | none built. The only cheap candidate is a Sputnik DAO set as `payout_recipient`, which configures an existing field and is not a built product; the bounty board with earned trust needs about 1.5 agent-days | none | The budget in section 8.3 has no 1.5 agent-days of slack | 0 | none | Re-open only if the Nov 11 M-gate shows 1.5 spare agent-days (expected: no) |
| open | A | medium | The whole platform story: `make tour` (seven scenes), objections section, optional verdict-consumer example (CO-4 section 10) | `make tour` ends `TOUR GREEN`; full `scripts/judge-run.sh` | Judged on novelty; no "first" claim; Solana pieces not judged (Q-002) | 0.35 | all tracks | List if judge-run is green |

**Rule F-TRACK (freeze-time claim).** A track id enters `submission/FORM-PAYLOAD.md` only if `scripts/claimed-tracks.sh` marks it green: it runs the track's step on a clean clone at the freeze commit and writes `submission/track-claims.json`. A red step removes the id. A track is never listed for a roadmap module. The list is rechecked at the Nov 13 preflight and then fixed, because the form cannot be edited by the team (changes go through an organizer-reviewed request, `hackathon-a.md` read 2026-11-08). The per-track checklist with owners is in PLAN.md (CO-3 Part).

Summary (CO-4, worded to match Dami's "six" ruling R-16): **six targeted** (memecoins, security, open as tier A; defi, swarms, agents as tier B) **plus thesis as a conditional seventh** (tier B, promoted by CO-4 per R-17 only if Dami delivers the credentials), **2 stretch** default not listed (nfts first, business), **4 dropped** (privacy, realworld, games, social). Incremental effort: targeted tracks 7.65 agent-days including shared agentkit (0.70) and agent vault (1.00); budget and cut order in CHANGE-ORDER-4 section 14. Whether many tracks help or hurt in judging is [UNVERIFIED]; no penalty is stated in the rules.

### 1.7 Deep integration record (NEAR surfaces, load-bearing or not)
| NEAR surface | Load-bearing | What breaks if deleted |
|---|---|---|
| NEAR Intents (`intents.near` Verifier, `mt_on_transfer`, 1Click) | Yes | Phantom-only buyers cannot commit or walk; the solvency anchor disappears |
| Factory token (`token.primitives.near` `create_token`) | Yes | `create_trial` cannot create the launch token; creators would need an own-FT route (not approved) |
| Native USDC (NEP-141) | Yes | There is no quote asset; every amount is denominated in it |
| Chain Signatures (`v1.signer`, Ed25519 domain 1) | Yes if F0 is the shipped genesis path (F0 primary, F1 fallback, RULED 2026-11-08). Proven on mainnet (T0-T5) | If F0 passes rehearsal by the Nov 10 gate it is load-bearing; if the gate ships F1 it reverts to a disclosed upgrade path and a security-track proof |
| Market-lite (own contract, `market.kruxa.near`) | Yes for the defi and memecoins market claims | Without it a launched token has no NEAR venue and the fee router is inert |
| NEAR AI Cloud / TEE | Not used | n/a |

Surfaces load-borne: 3 of 5 listed, plus 1 conditional (Chain Signatures if F0 ships), with no decoration claimed for the other (`deepIntegration.surfacesLoadBorne = 3`, `surfacesTotal = 5`; CO-3 note: becomes 4 if F0 is adopted).

### 1.8 Why This Wins
The judging rubric is not published; criteria are derived with equal weights (WINNER-BRIEF). Two AI judges (Claude Code, Codex) run the README verbatim; humans decide.

| Judging criterion (derived) | Weight | How Kruxa addresses it | Honest weak point |
|---|:---:|---|---|
| Reproducibility | 33.3% | Every README step has a no-funds path: `make test-unit`, `make sim`, `verify.sh` against devnet launches, dry quotes, simulated genesis. Clock is a parameter of the same wasm (labelled demo account) | Weakest leg in the warroom (5.5 of 10). Superset scope and two Intents waits (9-42 s) make a cold run fragile |
| Fit to track | 33.3% | Verdict-gated existence on a second chain is a mechanism, not a wrapper; the track set of section 1.6 honestly claimable under the freeze-time rule | Memecoin prompt expects a supply mechanic; ours is fixed supply |
| Concrete NEAR role | 33.3% | Intents in and out, factory token, NEAR contract as sole judge of Solana existence, Chain Signatures proven (T0-T5) | Chain Signatures not in the shipped genesis path unless F0 is adopted |

Warroom round-0b weighted total was 6.5 of 10, uniqueness 7.25; those scores predate the product vision and the signed tests. Mainnet facts proven since: Chain Signatures Ed25519 signing T0-T5 PASS [PROVEN: signed test, section 5 A6].

---

## 2. System Architecture Overview

### 2.1 System Diagram
```
 NEAR buyer (Priya)                       Solana-only buyer (Kofi, Phantom)
   USDC (NEAR)                              SOL or USDC (Solana)
      |  ft_transfer_call                      |  1Click quote to own Intents account
      v                                        v
 +-------------+      mt_on_transfer      +-----------+
 |  USDC NEP-  |      (S3, buyer signs)   | intents.  |<--- signed raw_ed25519 transfer
 |  141        |                          |   near    |     (anyone submits)
 +------+------+                          +-----+-----+
        | ft_on_transfer                        | mt_on_transfer + refund by return value
        v                                       v
 +--------------------------------------------------------------+
 |  core.kruxa.near  (C1)  Charter, hold ledger, Position,      |
 |  trial lifecycle, Walk, settle, pull refunds, stream-lite,   |
 |  roles, caps, pause                                          |
 +-----+---------------+------------------+---------------------+
       |               |                  |
       | create_token  | views, events    | commit_genesis / confirm_genesis
       v               v                  v
 +-----------+   +------------+    +-----------------------------+
 | token.    |   | Indexer    |    | Genesis relayer (C7)        |
 | primitives|   | (C14)      |    | watcher, compiler, simulate |
 | .near (C3)|   +-----+------+    | submit, confirm             |
 +-----------+         |           +-------+---------------------+
                       v                   | genesis tx1, tx2
              +-----------------+          v
              | Web app (C12)   |   +-------------------------------------+
              | landing, studio |   | Solana: mint (null authorities),    |
              | board, trial,   |   | Metaplex metadata, Jito distributor |
              | portfolio, demo |   | (C8), Squads reserve vault (C9),    |
              +--------+--------+   | SAS attestation (C10)               |
                       |            +-------------------------------------+
                       v
              +-----------------+      +-----------------------------+
              | verify.sh (C11) |<-----| NEAR RPC + 2 Solana RPCs    |
              | kruxa-sim       |      | (read only, no keys)        |
              +-----------------+      +-----------------------------+
 Later waves: market + Hold Vault (C5, C6), agent/API layer (C13), keeper (C15)
```

### 2.2 Component Table
Wave tags: W1 core, W2 Solana side, W3 surfaces, W4 submission packaging, W5+ after the hackathon (section 8).

| Component | Type | Purpose | Key Dependencies | Wave |
|---|---|---|---|---|
| C1 Core contract | NEAR contract (`core.kruxa.near`, monolith) | Charter, hold ledger, trial lifecycle, Walk, verdict and settle, pull refunds, token claims, stream-lite, roles, caps, pause, genesis commit/confirm records | C2, C3, C4, USDC, `intents.near` | W1 |
| C2 Pure logic crates | Rust libraries (`kruxa-math`, `kruxa-types`, `kruxa-logic`, `kruxa-sim`) | U256 math, rule codes and `validate_charter`, verdict, allocation, memo parse, GenesisSpec compiler, offline simulator. Linked by the contract, the simulator and `verify.sh` so recompute uses identical math | none (no near-sdk in the math crate) | W1 |
| C3 Token provider | Trait inside C1 (`FactoryPrimitives`, `OwnGlobalByHash`) | Create the launch FT at `create_trial`; verify code hash in a callback; `burn_mode` for dead tokens | `token.primitives.near` | W1 |
| C4 Intents intake | Methods in C1 (`ft_on_transfer`, `mt_on_transfer`, S4 fallback methods) | Credit commits from NEAR USDC and from Intents; guard the caller; carve the relay fee; refund by return value | USDC contract, `intents.near`, 1Click, Phantom | W1 |
| C5 Market contract (Market-lite) | NEAR contract (`market.kruxa.near`) | Constant-product pool per launch, fee router, FeeLedger, creator claims to the payout recipient. Scope M-A pre-freeze; M-B (referral lots, ratchets) later | C1 (`open_market`), USDC, launch FT | W2M pre-freeze (CO-3); M-B W6b |
| C6 Hold Vault | Module inside the market wasm | Stake to earn, instant unstake, 7-day claim gate, holder rewards index. Until it ships the holder slice is redirected to LP | C5 | W6b (after hackathon) |
| C7 Genesis relayer | Off-chain service (TypeScript) plus one-session genesis host | Watch PASS, compile and simulate genesis, submit tx1 and tx2, confirm on NEAR, destroy genesis key | C1, Solana RPC, Metaplex, KMS (beta) or memory (demo) | W2 |
| C8 Solana distribution | Solana programs used as-is (Jito merkle distributor) plus Merkle builder | Claim-based distribution beyond the 7-holder single-transaction limit; 90-day clawback to community pool | Jito distributor, C1 `build_root_page` | W2 |
| C9 Squads reserve | Solana multisig (Squads v4) | Hold the reserve and LP-mirror buckets; demo: Dami holds all 3 keys on separate hardware wallets, disclosed single-party | Squads v4 | W2 |
| C10 Verdict Rail | Solana attestation (SAS) | Publish a verified-launch attestation signed by the standing ATTEST key (disclosed) | SAS program | W2 (one attestation, if time) |
| C11 Verification tooling | Python `verify.sh` plus `kruxa-sim verify` | Recompute verdict, book hash, ledger identities, genesis checks C1-C34, tamper tests | C2, NEAR RPC, Solana RPC | W2 |
| C12 Web app | Frontend (Next.js [ASSUMED], per global default) | Landing, Studio, Verdict Board, Trial page, Portfolio, judge route, proof route | C1 views, C14 | W3 |
| C13 Agent/API layer | HTTP API, MCP server, `llms.txt`, `AGENTS.md`, OpenAPI | Read-only access to launches, verdicts, verify results | C14, C11 | W3 (read-only) |
| C14 Indexer | Event store, read model, candles, trades feed, open dataset export | Portfolio index, launch feed, token candles and trades, book-hash fold | neardata or NEAR RPC, C1 and C5 events | W2I (CO-3) |
| C15 Keeper and monitor | Off-chain jobs | Call permissionless methods (`settle`, `settle_positions_page`, `consolidate`, `sweep_residue`), run `check_solvency`, alert | C1 | W1 scripts, W5 service |
| C16 Signed-test kit and dry-run harness | Scripts (`warroom/signed-tests`, `make sim`, fixtures) | Plumbing tests with throwaway keys; no-mint guard; judge dry-run path | C1, devnet, testnet | W0 done, W4 packaging |
| C17 Solana venue service | TypeScript service `services/venue` | Devnet spike (DAMM v2 locked-LP pool, four DBC checks, and a fee-claim test from a position owned by a PDA or a Squads vault), then a builder for the Squads proposal that creates the pool. Fallback tree [DN-22, adopted for planning]: DAMM v2 primary; Raydium CPMM first (Burn and Earn locker, Fee Key NFT, about 0.19 SOL per pool against about 0.022 SOL, secondhand [UNVERIFIED]); Orca Whirlpools second (full-range lock only); an own pool program is rejected. DAMM v2 has no built-in platform/creator fee split and no anti-sniper limiter (only the decaying base-fee scheduler), so Kruxa does the split itself: two locked positions with different owners, or one claimer plus a Kruxa payout | Meteora, Raydium, Orca programs, C9 | spike W2 pre-freeze; mainnet pool after the 48 h timelock; the builder itself is deferred if DN-28 is ruled |
| C18 Payout recipient and creator earnings | Rules in C1 and C5 plus Creator Desk views | Payout recipient default, fixed at open; earnings view, claims, CSV export (section 4b) | C1, C5, C14 | W2M and W3 |
| C19 Launch Check API and guard | `services/check`, `guard/` | allow, warn or block with reasons; client-side guard for agents (security track) | C11, C14 | W3 (tier A) |
| C20 Backer agent and MCP | `agents/backer`, `mcp/` | Policy-bound agent with receipts (agents track) | C13, C19 | W3 (tier B) |
| C21 Swarm simulator | `swarm/` | 20 scripted buyers; doubles as the seed script | C1 testnet | W3 (tier B) |
| C22 Wallet layer | `app/lib/wallet` | near-connect for NEAR, wallet-standard chooser for Solana, chain-labelled sessions | C12 | W3 |
| C23 Survivor Pass, C24 Thesis pack, C25 Keeper business ledger | `contracts/pass`, `thesis/`, `keeper-biz/` | Tier C stretch modules | see section 1.6 | W3 only if slack |
| C26 Hosting tier | Ops | Public app and indexer through Nov 25 (CHANGE-ORDER-3 section 10) | C12, C14 | W3 |

### 2.3 Data Flow
The hold ledger in C1 is the only place money is recorded. Money enters C1 in one of three ways: a NEAR USDC `ft_transfer_call` (`ft_on_transfer`), an Intents transfer with a flat `msg` field (`mt_on_transfer`, S3 primary), or an Intents transfer submitted through C1 (`contribute_via_intents`, S4 fallback). Each credit becomes a `Position` in the Charter's launch, with a rolling `book_hash` folded over every credit and Walk event.

Walk and `settle` change recorded numbers only. They make no cross-contract call, so a stuck payout can never change a verdict, and a verdict can never be blocked by a stuck payout. After the walk deadline anyone calls `settle`. On PASS it allocates four buckets (launch fee, LP seed, stream, excess refund) in one atomic step, then keepers run `settle_positions_page` and `consolidate`. On FAIL every active position becomes refundable. Refunds are pull-based: debit first, pay second, re-credit in a callback that never panics.

After PASS, the genesis relayer reads the launch, compiles the GenesisSpec, commits its hash to C1 (`commit_genesis`), runs the ceremony on Solana (mint, metadata, buckets, distributor, authorities set to None, in the same session), then calls `confirm_genesis`. NEAR cannot verify a Solana transaction, so `confirm_genesis` is a signed claim that `verify.sh` audits ("detected, not prevented"). Solana-origin buyers claim their tokens from the Jito distributor with a Merkle proof.

Anyone can run `verify.sh <launch_id>`: it reads NEAR and two Solana RPC endpoints, rebuilds the verdict, the book hash, the GenesisSpec hash and the distribution, and prints MATCH or MISMATCH per check. No keys, no accounts.

### 2.4 Trust boundaries and disclosed trust
| Boundary | Trust assumed | Disclosure |
|---|---|---|
| `intents.near` Verifier | Holds Intents-custody USDC; DAO-held force functions (`ft_force_withdraw`, `mt_force_transfer`, `mt_force_withdraw`, `force_lock_account`) exist [VERIFIED: wasm scan, S1-B] | Time in Intents is minimised: consolidated to native USDC after PASS, refunded on FAIL. Solvency tripwire `reconcile_intents` |
| Factory token contract | Global contract with a single publisher-updatable full-access key (`ft.globals.primitives.near`) [VERIFIED: WINNER-BRIEF pre-build decision 4] | Disclosed in README and on the charter page. Own-FT by hash is the fix and is not approved |
| Genesis key G (F1) | Trusted for exactly one ceremony session; memory-only in the demo, AWS KMS non-exportable in beta | "Detected, not prevented"; `verify.sh` audits that G holds nothing and signed only the ceremony transactions |
| Verdict Rail ATTEST key | Standing key signs SAS attestations | Disclosed. F1 wording: "no later action on the token; attestations are a separate disclosed key" (DECISIONS-PACK1 #10) |
| Squads reserve (demo) | Dami holds all 3 keys on separate hardware wallets [RULED]; three separate devices are needed by the Nov 10 gate (the vault is created then), so order now if not owned | Disclosed as single-party. 2-of-3 with two named independents before third-party creators open |
| Upgrade authority | Phase 0: Dami key, disclosed. Phase 1: 2-of-3 hardware multisig, 7-day timelock, pause-only guardian | In README risk box |
| Independent review | None before the Genesis Round | Review gap disclosed (RULED) |
| Hosting | Tier 2 [RULED DN-16, 2026-11-08]: Next.js app on a managed host plus a small indexer VM, durable (no spin-to-zero), kept up through Nov 25 (minimum Nov 18); degrades to baked snapshots and direct RPC reads if the indexer dies; the verify path never depends on the indexer | Durable hosting through Nov 25 (Q-012); provider and accounts are still Dami's task (P-23) |
| Market contract | `market.kruxa.near`, NEW money-holding code with no independent review; pool reserve caps and a pause | Disclosed on `/charter`; mainnet only behind the M-gate and per-action confirmation |

---

## 3. User Flows

Flows 1 to 10 are the flows the hackathon slice ships and the demo shows. Roadmap flows (Earned Terms, Standing Orders, market buy and sell, holder rewards, fee claims) are listed at the end of this section; they are specified at roadmap level in section 8 and are not counted in the flow-to-demo check.

Rehearsal environment for every flow below unless marked MAINNET: NEAR testnet and Solana devnet. Intents has no testnet [VERIFIED: PULSE Q-007], so Intents legs on testnet use a mock Intents contract in the sandbox, and live Intents behaviour is shown only through recorded mainnet plumbing receipts labelled RECORDED.

### Flow 1: Creator opens a launch (preset, hostile refusal, valid trial)
1. Maya opens Studio and picks a preset (supply, bucket split, caps, window, tail, stream length, fee terms).
2. Studio calls the `preview_charter` view. The page shows the result or the rule codes. No wallet needed for this step.
3. Maya edits the preset to a hostile one (creator allocation 60%, zero window). `preview_charter` returns `R_ALLOC` and `R_WINDOW`. The Create button stays disabled.
4. Maya fixes the config and signs `create_trial` with the required deposit (creator bond sized `max_holders x 0.0033 NEAR + 0.013`).
5. C1 validates the whole Charter, snapshots it, stores `charter_hash`, and calls the token provider. On callback success the launch becomes Open (or Scheduled if `open_delay` is set) and `trial_opened` is emitted.
6. Edge cases: a second active launch from the same account returns `R_ACTIVE_TRIAL`; a deposit below `required_deposit` returns `R_DEPOSIT`; a taken or reserved symbol returns `R_SYMBOL`; if token creation fails the status becomes `CreationFailed`, the deposit returns to Maya, and no trial ever opened; if the callback never arrives, anyone calls `finalize_creation` after 10 minutes.

### Flow 2: NEAR buyer commits USDC
1. Priya calls USDC `ft_transfer_call` with the launch id in `msg` and at least 50 Tgas attached.
2. C1 `ft_on_transfer` checks the caller is the USDC contract (`R_UNEXPECTED_TOKEN` otherwise), parses `msg` (unknown fields rejected, at most 512 bytes), and applies the common commit rules in order: status Open, phase Open, not paused, not creator or payee (`R_SELF_BUY`), amount at least the minimum (`R_MIN_CONTRIBUTION`), wallet cap (`R_CAP_ACCOUNT`), position count (`R_CAP_HOLDERS`), delivery target valid (`R_DELIVER`).
3. On success the Position grows, `contributed` is emitted, `book_hash` folds the event.
4. On any rejection the full amount is returned as unused. A commit in the wrong phase never panics and never strands money.

### Flow 3: Solana-only buyer commits through Intents (S3 primary, S4 fallback)
1. Kofi gets USDC into his own Intents account (1Click quote with his hex-encoded Solana public key as recipient and his Solana address as `refundTo`).
2. The app shows the relay fee (flat, in USDC, taken from the commit amount) and the net amount before he signs. Net must be at least the $10 minimum.
3. Phantom `signMessage` signs one `raw_ed25519` payload containing a transfer intent to `core.kruxa.near` with a flat `msg` and `min_gas` of 50 Tgas.
4. Anyone submits `intents.near.execute_intents` (Kofi can submit himself; otherwise the submitter's gas is recovered from the relay fee, not paid by the platform).
5. `intents.near` credits C1 and calls `mt_on_transfer`. C1 checks the predecessor is `intents.near`, one token, the USDC token id, and treats `sender_id` as the payer. It credits principal equal to the amount minus the relay fee, accrues the relay fee, and returns `[0]`.
6. On rejection C1 returns the full amount; `intents.near` moves it back to Kofi's Intents balance automatically. This also happens if C1 panics.
7. S4 fallback (built only if the live S3 test fails): Kofi signs a memo-carrying transfer to the Verifier; C1 `contribute_via_intents` forwards the exact payload string to `execute_intents` and credits in a callback; an orphaned credit is claimable with `claim_orphan_credit`.
8. Edge cases: signer id is the lowercase 64-hex of the public key; a hex signer who asks for delivery to a different address is rejected with `R_DELIVER` in v1; a relay fee above the ceiling returns `R_RELAY_FEE`.

```
Kofi/Phantom         anyone            intents.near           core.kruxa.near
   | sign payload       |                   |                        |
   |------------------->| execute_intents   |                        |
   |                    |------------------>| verify, move balance   |
   |                    |                   | mt_on_transfer(msg)    |
   |                    |                   |----------------------->| checks, credit
   |                    |                   |<-----[0] or amounts----| accept or refund
```

### Flow 4: Buyer walks and recovers principal
1. Before `walk_end`, the buyer opens the Walk sheet. It prints: "Returned to your account now: your principal. A relay fee, if you paid one, is not returned. If you also move funds to your Solana wallet, Intents charges a fee, shown from a live quote before you sign." The text never says "100% back".
2. NEAR account: calls `walk` with 1 yoctoNEAR. Phantom-only buyer: signs a `walk_signed` message `kruxa:walk:v1|<contract>|<launch>|<payer>|<nonce>|<deadline>`; anyone submits it.
3. Step 1 is synchronous and atomic: the whole position is removed from `total_active`, `active_funders` falls by one, `book_hash` folds the Walk event. Walk is all-or-nothing (no partial Walk).
4. Step 2 is the money leg, retryable: `claim_refund` pays NEAR buyers' USDC to their account, and Intents buyers' USDC to their own Intents account (`mt_transfer`). The destination is fixed by the Position, so a third party can trigger the call but cannot redirect the money.
5. Edge cases: Walk before open returns `R_WALK_CLOSED`; Walk at or after `walk_end` returns `R_WALK_CLOSED`; a caller with no position gets `R_NO_POSITION`; a walker may commit again while the commit phase is open and counts as a new backer.

### Flow 5: Settle (deterministic verdict)
1. At or after `walk_end`, anyone calls `settle(launch_id)`. Before then, `R_TOO_EARLY`.
2. `settle` reads the frozen book and calls the pure `verdict` function. PASS requires total active commits at least the soft cap AND active backers at least the minimum AND not cancelled. Otherwise FAIL with a bitset of reasons (`BELOW_SOFT_CAP`=1, `BELOW_MIN_FUNDERS`=2, `CANCELLED`=4).
3. `settle` makes no cross-contract call. On PASS it allocates the launch fee, LP seed, stream and excess-refund buckets and starts the stream clock. On FAIL it makes every active position refundable and sets creator, platform and launch fee accruals to zero.
4. Repeat calls return the stored outcome (idempotent). A judge recomputes with `kruxa-sim verdict` and sees MATCH.
5. After PASS, keepers run `settle_positions_page`, `consolidate` until native USDC covers launch fee, LP seed and stream, then `sweep_residue`.

### Flow 6: Dissolve (FAIL path) and refunds
1. After a FAIL, each backer calls `claim_refund` (or a keeper calls it for them). Refunds follow the destination rule in Flow 4.
2. `dissolve` succeeds only when no positions remain unpaid and no transfer is in flight (`R_NOT_CLEAR` otherwise). It releases the creator bond.
3. The dead launch token is handled by `burn_mode` (`Burn`, `Sink(account)` or `Hold`). Whether the factory token supports `ft_burn` is contradictory across specs and is checked on testnet in Wave 0 [OPEN: OV9].
4. The Solana address for this launch never becomes a mint. `verify.sh` check C30 asserts no `genesis_committed` event exists and prints that the Solana account is absent.
5. Edge cases: unclaimable refunds are never forfeited in v1 (ruling #19); a refund whose transfer fails is re-credited in the callback and can be retried.

### Flow 7: After PASS, backer claims tokens and the creator draws the stream
1. NEAR-delivery backers call `claim_tokens` with at least 0.00125 NEAR attached for the token-contract registration. Tokens equal `floor(c_i x N_sale / total_active)`. [SYNC 2026-11-10: the call is payable: attach 1 yocto when the holder is already registered on the launch token, or 0.00125 NEAR + 1 yocto when not; the core registers the holder inside the claim (NEP-145) and refunds everything above what it used; about 150 to 200 Tgas (the app attaches 200)]
2. The creator (or the `stream_recipient`) calls `draw`. The cap at time t is `floor(total x (t - pass_at) / duration)` and is zero at or before PASS.
3. The demo shows "Withdraw all" reverting with `STREAM_CAP`. A call before the stream exists has no stream row to draw from and is refused (`R_WRONG_PHASE`; S1-C spells it `NOT_PASS` [ASSUMED mapping]).
4. Creator allocation vesting and the backer bonus are specified in S1-C section 6. The backer bonus is a 30-day linear vest [RULED 2026-11-07] and ships in the full-v1 track; the Genesis Round charter sets `creator_bps` and `backer_pool_bps` to zero unless Dami says otherwise [ASSUMED from RECONCILED section 7].

### Flow 8: Solana genesis and claim-based distribution
1. After `settle` PASS and `consolidate`, the relayer's watcher sees `pass_allocated`.
2. The relayer compiles the GenesisSpec from Charter and state, simulates both transactions, creates the genesis key G, funds it, and calls `commit_genesis` with G's public key. C1 stores the spec hash and Merkle root and emits `genesis_committed`. A second call returns `R_GENESIS_ALREADY`; a call in a state other than PASS returns `R_GENESIS_STATE`.
3. The relayer submits tx1 (create mint with seed, metadata) and tx2 (create buckets, mint all supply, set mint and freeze authority to None, create the Jito distributor, set admin to a null admin). The mint is a classic Token program mint of 82 bytes with no extensions.
4. The relayer self-checks, calls `confirm_genesis` (mint, signatures, slot, ceremony hash), sweeps leftover SOL, destroys G.
5. Solana-origin backers claim from the distributor with a Merkle proof; the claimant pays claim rent from a buyer-funded refundable 0.004 SOL deposit carved out of the buyer's contribution, not paid by the platform. [SYNC 2026-11-10: NOT implemented. The decision is that the buyer's quoted relay fee, taken from the commit amount, is the buyer-funded claim cost; core holds no 0.004 SOL deposit (`get_token_custody.solana_claim_rent = relay_fee_covers`) and the relayer's funder account pays Solana-side claim rent (`relayer/src/claim.ts`, per the 2026-11-09 audit). Disclosed in LIMITATIONS]
6. Abort path: before `confirm_genesis`, the relayer or the guardian calls `abort_genesis` and the launch stays resolvable for creator and backers.
7. Platform pays only genesis rent and fees (about 0.0263 SOL in the S1-D budget; DECISIONS-PACK1 quotes 0.0193 SOL from a 3-holder shape) and attestation rent (about 0.00266 SOL, reclaimable), funded from the launch fee.

```
core.kruxa.near        relayer (C7)           Solana
      |  pass_allocated     |                     |
      |-------------------->| compile + simulate  |
      |<--commit_genesis----|                     |
      | genesis_committed   |---- tx1, tx2 ------>| mint, buckets, distributor,
      |                     |                     | authorities None
      |<--confirm_genesis---| self-check, destroy G
```

### Flow 9: Judge or stranger verifies a launch with no keys and no funds
1. The judge opens the deployed URL: no login wall, seeded devnet and testnet launches visible with tx hashes labelled "opened earlier".
2. The judge clones the repo, checks out the `hackathon-submission` tag, runs `make test-unit`, `make sim`, `kruxa-sim verdict` fixtures (boundary equal passes, boundary minus one fails), then `./verify.sh <launch_id>`.
3. `verify.sh` exits 0 for a verified launch; exits 2 on a mismatch; 3 when pending; 4 when RPC endpoints disagree or fail. `./verify.sh <launch_id> --tamper-all` flips one value per run and must exit 2 with a MISMATCH line each time.
4. If outbound network is blocked, `--evidence FILE` replays recorded RPC responses and labels the output "RECORDED, not live".
5. The judge runs `scripts/hostile-preset.sh` (read-only view) and sees the rule codes.

### Flow 10: Genesis Round ($KRUXA brand launch, gated) [CO-3 re-timed]
1. Gate review on **Nov 10 EOD** against the list in section 9.3 (hard rows cannot be waived). Output: GO or NO-GO written by Dami, per action.
2. On GO, Nov 11 morning UTC: Dami confirms the mainnet deploy of `core.kruxa.near` (with the creator gate closed to everyone but the owner), then each signature or spend one by one. The token is a factory token. Caps $1,000 per launch and $3,000 global in USDC. Target open time Nov 11 12:00 UTC; latest open time Nov 11 18:00 UTC (section 8.3).
3. The trial opens with production bounds (commit window at least 24 hours, tail at least 1 hour). Banner: "Genesis Round: capped launch of the Kruxa brand token. No independent audit has been done. The reserve vault is controlled by one person."
4. Settle about Nov 12 14:00 to 19:00 UTC. If PASS: genesis (F0 primary, F1 fallback) with Dami's confirmation, then `verify.sh` on the mainnet launch, linked in the repo.
5. NEAR market: after settle, `market.kruxa.near` (deployed Nov 12 behind the M-gate, Dami confirms) receives 100% of the LP seed through `open_market` [RULED DN-14: round one seeds Kruxa's NEAR pool only; the 48 h timelock does not gate it]; the NEAR pool LP is permanent inside the contract, so it needs no human timelock. Pool and LP-seed amounts, and any later Solana share, stay OPEN (O-14). If a Solana share is later allocated: the USDC LP seed reaches the Squads vault only after the 48 h timelock (about Nov 14 16:00 to 22:00 UTC) and an Intents withdrawal (OV15 unproven); the Meteora DAMM v2 pool is created from the vault after that, so it may land after the deadline and is disclosed.
6. After step 4 succeeds, the capped beta may open (section 4b and BLK-1).
7. On NO-GO: the launch moves past the hackathon; the README says so and shows testnet/devnet rehearsals plus recorded mainnet plumbing receipts.

### Roadmap flows (not counted, specified in section 8)
- Earned Terms: the creator's record sets future fee, deposit and raise cap.
- Standing Orders and Survivor Pass: buyer-side rules and a backer record.
- Market: buy and sell on the post-PASS pool with a fee router is pulled forward as Market-lite (CO-3). Still roadmap: referral lots, ratchets, holder rewards through the Hold Vault, Solana-side fee income, best-venue routing.
- Verdict Rail upgrade: attestation signed by a NEAR-controlled key (F0).

---

## 4. Technical Specifications

Specs below give interface contracts and schemas, not implementation. Component names match the table in section 2.2. Full records are in `specs/RECONCILED-INTERFACE.md` section 3, which is the canonical shape where S1-A, S1-B, S1-C and S1-D disagree.

### C1 Core contract
- **Purpose:** One monolith account (`core.kruxa.near`, crate `kruxa-core`) holding the Charter registry, hold ledger, trial lifecycle, verdict and settle, refunds, token claims, stream-lite, roles, caps, pause and genesis records. Reason for one contract: NEAR cross-contract calls are async promises, so one contract keeps every state change inside one receipt.
- **Interface:** public method table below. Access classes: ANY, OWNER, GUARD, CREATOR, HOLDER, PAYEE, RELAYER (`GENESIS_RELAYER`), SELF.
- **Key data structures:** `CharterV1` (launch id, topology, creator, rules snapshot, token spec, supply plan, raise terms, window, verdict rule, fee terms, creator terms, payees, launch fee terms, genesis plan, caps, market mode); `LaunchStateV1` (charter hash, status, halted flag, live terms, timestamps, ledger, stream, token state, genesis state, `book_hash`, verdict inputs hash, settlement, bond, holder count); `HoldLedger`; `Position`; `SettleResult`. All times are `U64` nanoseconds; amounts are `U128` USDC micro-units (6 decimals) or token base units.
- **Dependencies:** C2, C3, C4, USDC contract, `intents.near`.
- **Events/signals:** NEP-297 standard `kruxa`, version 1.0.0 (list in RECONCILED section 5.2). No unbounded arrays in a log; each log at most 16 KB.
- **Constraints:** Rust 1.95.0, `near-sdk =5.30.1`, no `universal-accounts` feature (mainnet reports protocol 88, [VERIFIED 2026-11-08, RPC `status`]; the feature stays OFF because it is unneeded and unaudited, not because of the protocol). Gas classes S under 15, M 15-60, L 60-150, XL 150-300 Tgas. No cross-contract call inside `settle`, `walk`, or any verdict input path.

#### C1 detail A: parameters, bounds, defaults (snapshotted at `create_trial`)
| Field | Default | Bound | Code | Source |
|---|---|---|---|---|
| Supply (whole tokens, 6 decimals) | 1,000,000,000 | 10M to 1T; base units fit u64 | `R_SUPPLY` | S1-A 6.2 |
| Sale / LP / creator / backer buckets (bps) | 6000 / 2500 / 1000 / 500 | sale 5000-8000, LP 1500-4000, creator 0-2000, backer 0-1000; creator+backer at most 2500; sum 10,000; platform bucket 0 | `R_BUCKETS`, `R_ALLOC` | S1-A, S1-B |
| Reserve bucket | 0 | 0-3000 bps | `R_BUCKETS` | [OPEN] vs the 15-30% in the vision |
| Hard cap H | creator-set | $500 to $250,000; demo and Genesis Round $1,000 per launch | `R_HARD_CAP`, `R_CAP_LAUNCH` | S1-B, RULED caps |
| Soft cap S | 30% of H | at least max(20% of H, $100), at most H | `R_SOFT_CAP` | S1-B |
| Minimum buy | $20 | at least max($10, ceil(H/500)); checked after the relay fee | `R_MIN_CONTRIBUTION` (alias `R_MIN_BUY`) | S1-B, RULED R2 |
| Per-wallet cap | max(ceil(H x wallet_bps/10,000), 5 x minimum buy) | wallet_bps 50-500, default 200 | `R_CAP_ACCOUNT` (alias `R_WALLET_CAP`) | S1-B |
| Minimum backers M | 25 | 10-500; M x minimum buy at most S | `R_FUNDERS`, `R_PASSABLE` | S1-B |
| Open delay | 0 | 0-7 days | `R_WINDOW` | S1-B |
| Commit window | 72 h | 24 h to 30 d (S1-B says 14 d; tier-3 ruling #27 and RECONCILED use 30 d) | `R_WINDOW` | DECISIONS #27 |
| Walk tail | 6 h | 1 h to 48 h | `R_WINDOW` | S1-B |
| Max holders | 500 (demo) | at most min(500 demo, ceil(2 x H / minimum buy)) | `R_CAP_HOLDERS` | RECONCILED |
| Global cap (all launches) | $3,000 | raising is timelocked | `R_CAP_GLOBAL` | RULED 2026-11-07 |
| Launch fee | min(2,500, 3% of A, max(1.5% of A, 10)) USDC | rate 150 bps, ceiling 300 bps | `R_LAUNCH_FEE` | S1-B formula |
| Relay fee | quoted flat in USDC | at most $0.50 and at most 5% of the amount (RECONCILED); DECISIONS-PACK1 suggests at most 1% | `R_RELAY_FEE` | [OPEN] conflict, section 9 |
| Stream length | 90 d | at least 30 d if H at most $25,000, else at least 90 d; at most 365 d; initial release 0 | `R_STREAM`, `R_STREAM_INIT` | S1-A | [SYNC 2026-11-10: the Studio default is 30 days (DECISIONS-PACK1 fifteenth block); 90 days is the minimum above a $25,000 hard cap, not the default. `R_STREAM_INIT` and `R_PAYEES` exist in `RuleCode` with pure checks; `R_STREAM_INIT` is called at `settle` as a guard (initial release is zero by construction), `R_PAYEES` is called by no core method] |
| Fee terms (total fee, shares, referral, opening decay, vesting, payees) | per vision section 4 | validated at create even though the market ships later | `R_FEE_TOTAL`, `R_CREATOR_SHARE`, `R_CREATOR_TAKE`, `R_PLATFORM_FLOOR`, `R_PLATFORM_FIXED`, `R_HOLDER_LP_FLOOR`, `R_HOLDER_RANGE`, `R_LP_RANGE`, `R_REFERRAL`, `R_SPLIT_SUM`, `R_FEE_VEST`, `R_PAYEES`, `R_VEST`, `R_OPENING` | S1-A 6.2 |
| One active launch per creator | 1 | | `R_ACTIVE_TRIAL` | S1-A |
| Genesis flags | mint authority None, freeze authority None, no extensions | all three required | `R_GENESIS_AUTH` | S1-A |

Genesis Round arithmetic at the $1,000 cap (hard cap H = $1,000, defaults above), computed with exact integer rules:
| Item | Value |
|---|---|
| Smallest legal soft cap | max(20% of 1,000 = $200, $100) = $200; at H = $500 it is max($100, $100) = $100 |
| Minimum backers vs soft cap | 10 x $20 = $200 at most the $200 smallest soft cap, so M = 10 is legal; at H = $500, 10 x $10 = $100 at most $100 |
| Per-wallet cap | max(2% x 1,000 = $20, 5 x $20 = $100) = $100 |
| Launch fee at accepted raise A = $1,000 | min(2,500, $30, max($15, $10)) = $15.00 |
| LP seed (USDC) | floor(1,000 x 2500 / 6000) = $416.666666 |
| Stream total | 1,000 - 15 - 416.666666 = $568.333334 |
| Platform cost per genesis | about 0.0263 SOL; break-even against the $15 fee at about $570 per SOL, and at about $380 per SOL against the $10 minimum fee. SOL price was not fetched [UNVERIFIED] |
| Global cap | three launches at $1,000, or one launch plus rehearsal headroom |

**Three kinds of waiting (do not confuse them; plain wording is in USER-ONBOARDING).** (1) The **Squads 48 h timelock** applies only to Kruxa's own reserve (the $KRUXA Solana-side LP seed and Kruxa's vault); ordinary creators never wait for it. (2) The **cap timelock** (7 days) applies only to raising the $1,000 and $3,000 raise caps or the $5,000 and $15,000 reserve caps. (3) The **trial window** applies to every launch: default 72 h commit plus a 6 h Walk tail (bounds 24 h to 30 d and 1 h to 48 h), then settle. A creator on a normal launch waits only for (3).

#### C1 detail B: state machine
Stored status: `Creating`, `CreationFailed`, `Open`, `Passed`, `Failed(reasons)`, `Dissolved`. A `halted` flag sits beside the status so halting an Open launch does not lose its state. The derived phase from `get_phase` while Open: `Scheduled` (before open time), `Open` (commit and Walk allowed), `Closing` (the walk tail: Walk allowed, commit refused), `Ready` (after `walk_end`: only `settle` changes anything).
| # | From | To | Trigger | Who | Failing condition returns |
|---|---|---|---|---|---|
| T1 | none | Creating | `create_trial` | any account | `R_PAUSED`, `R_ACTIVE_TRIAL`, any rule code, `R_DEPOSIT`, `R_SYMBOL`, `R_CAP_GLOBAL` |
| T2 | Creating | Open | `on_token_created`, `on_token_verified` | self | token code hash mismatch makes `CreationFailed` and emits `token_unexpected` |
| T3 | Creating | CreationFailed | token creation fails or `finalize_creation` after 10 minutes | self or anyone | deposit returns to creator |
| T4 | Open | Failed(CANCELLED) | `cancel_trial` before commit end | creator | `R_TOO_LATE` |
| T5 | Open (Ready) | Passed | `settle` | anyone | `R_TOO_EARLY`, `R_WRONG_PHASE` |
| T6 | Open (Ready) | Failed(reasons) | `settle` | anyone | same |
| T7 | Failed | Dissolved | `dissolve` | anyone | `R_NOT_CLEAR` |
Method versus phase: commit and Walk are accepted only in the phases shown in the flows; a commit in any other phase returns the money (never panics). After Passed, only settlement pages, token claims, excess refunds, consolidate, residue sweep, bond reclaim, stream draws and genesis methods change state.

#### C1 detail C: verdict and settlement
Verdict inputs (typed record): launch id, `charter_hash`, `total_active` (gross sum of active commits, including the part above the hard cap), `active_funders`, `soft_cap`, `min_funders`, `cancelled`. Output: Pass or Fail(bitset). `inputs_hash = sha256(borsh(inputs))`. No floats, no timestamps, no addresses, no discretion. Equality passes (`>=`); one micro-USDC below fails.

Settlement per buyer at final totals (sigma = total active, A = min(sigma, H), N_sale = floor(supply x sale_bps / 10,000)):
- `spend_i = ceil(c_i x A / sigma)` (never more than c_i)
- `refund_i = c_i - spend_i = floor(c_i x (sigma - A) / sigma)` (zero when sigma at most H)
- `tokens_i = floor(c_i x N_sale / sigma)`
- Anything paid to a buyer rounds down; anything charged rounds up; residue and dust go to the LP bucket, never to the creator or the platform.
- Four buckets sum to the committed basis: launch fee, LP seed, stream, excess-refund pool (identity L4).

Worked examples (from S1-B 2.6, recomputed 2026-11-07; supply 1,000,000,000 tokens, sale 60%, H = $5,000, S = $1,500, minimum buy $20, wallet cap $100, M = 25):
| Case | Inputs | Result |
|---|---|---|
| Oversubscribed | 130 backers, sigma = $12,500, A = $5,000. Buyer commits $100 | spend $40.00, refund $60.00, tokens 4,800,000. Launch fee $75, LP $2,083.33, stream $2,841.67 |
| Undersubscribed | 40 backers, sigma = $2,000 (above S, below H). Buyer commits $50 | spend $50.00, no refund, tokens 15,000,000. Whole 600M sale supply sells at a lower price |
| Rounding | H = $100, three buyers at 50,000,001 micro | spend 33,333,334 each, refund 16,666,667 each, residue 2 micro to LP, token dust 1 base unit to LP |
| Boundary | sigma = S and funders = M exactly | PASS; one micro-USDC less fails with `BELOW_SOFT_CAP` only |

#### C1 detail D: public methods (Wave 1 and Genesis Round track)
| Method | Access | Notes |
|---|---|---|
| `create_trial` (payable) | any | validates, snapshots, requests token |
| `on_token_created`, `on_token_verified`, `finalize_creation` | self, self, anyone after 10 min | creation recovery |
| `ft_on_transfer` | USDC contract only | commit entry for NEAR buyers |
| `mt_on_transfer` | `intents.near` only | commit entry for Intents (S3 primary, S2) |
| `contribute_via_intents`, `on_contribute_intents`, `claim_orphan_credit` | any, self, any | S4 fallback behind cargo feature `s4-fallback` |
| `walk` (1 yocto), `walk_signed` | holder, anyone with a valid signature | Phantom-only buyers need `walk_signed` or Walk is not real for them |
| `cancel_trial` | creator | before commit end |
| `settle`, `settle_positions_page` | anyone | promise-free |
| `claim_refund`, `claim_refund_batch`, `set_refund_route` | anyone (destination fixed), anyone, holder | batch is cut-first |
| `claim_tokens` | holder (NEAR delivery) | payable: 1 yocto when registered on the launch token, 0.00125 NEAR + 1 yocto when not (registration happens in the claim, the rest is refunded); about 150 to 200 Tgas |
| `consolidate`, `sweep_residue`, `dissolve`, `reclaim_bond` | anyone, anyone, anyone, creator | |
| `draw`, `lengthen_stream` | stream recipient, creator | stream-lite in Wave 1 |
| `commit_genesis`, `confirm_genesis`, `abort_genesis`, `build_root_page`, `attest_log_append`, `pause_genesis` | relayer (abort also guardian), relayer, relayer or guardian, relayer, relayer, guardian | Wave 2 stubs in Wave 1 |
| `check_solvency`, `reconcile_intents` | anyone | solvency tripwire against `intents.near` `mt_balance_of` |
| `pause`, `freeze`, `unpause`, `halt_launch`, roles, rule-set and upgrade queue, `force_resolve_op`, `withdraw_owed` | per S1-A section 10 | PAUSED keeps exits open; FROZEN auto-expires after 7 days; the stream clock keeps running during a pause |
| Views | any | `get_charter`, `get_state`, `get_ledger`, `get_position`, `list_positions`, `get_phase`, `preview_charter`, `preview_contribution`, `preview_settlement`, `get_verdict_inputs`, `get_settlement`, `get_invariants`, `get_book_hash`, `stream_status`, `declared_wallets`, `required_deposit`, `get_rule_set` |
Deleted from the canonical list: payable NEAR `contribute`, `credit_intake`, `release_lp`, `lp_release_*`, `Settling` status, `near_bps`.

[SYNC 2026-11-10: every method in the table above now exists in `contracts/core` (`release_lp_seed` was dropped and its row removed; `open_market` replaced it), and the core also has `open_beta`, `set_market`, `open_market`, `reopen_genesis`, `register_f0_message`, `sign_genesis`, `claim_creator_alloc`, `sweep_tokens`, `set_burn_mode`, `queue_upgrade`, `cancel_upgrade`, `upgrade_core`, `migrate`, `resume_launch`, `get_ops_state`, `get_token_custody`, `solvency_report`. Exact names, callers, arguments, limits and rule codes: `docs/interfaces/CORE-ABI.md`. New rule codes: `R_BURN_UNSUPPORTED`, `R_HALTED`, `R_LENGTHEN_ONLY`, `R_BATCH_SIZE`, `R_UPGRADE_HASH`, `R_GAS`.]

#### C1 detail E: invariants asserted after every mutation
L1 conservation (credited equals open plus in-flight plus paid plus fees plus spent plus excess due); L3 per-position sum; L4 bucket identity; L6 Intents liability against `mt_balance_of`; I2 position count equals active funders; I3 verdict inputs frozen after `settle`; I4 status never moves back to Open; I5 no position pays out more than it put in. Exposed as `get_invariants` and asserted in tests.

#### C1 detail F: attacks and defenses
| Attack | Defense |
|---|---|
| Fake token calls `ft_on_transfer` | predecessor must be the USDC contract: `R_UNEXPECTED_TOKEN` |
| Anyone calls `mt_on_transfer` directly | predecessor must be `intents.near`: `R_NOT_AUTHORIZED` |
| Creator or payee buys their own launch | `R_SELF_BUY` (partial: second wallets are not blocked; sybil resistance is not claimed) |
| Self-funding to force PASS | cost floor: launch fee lost, 41.7% to locked LP, stream releases over 90 days |
| Last-second whale | commits stop at commit end; walk tail lets everyone react |
| Walk-to-flip grief | wallet cap, margin shown in UI, accepted and disclosed |
| Front-running `settle` | outcome depends only on stored state; no keeper reward exists to race for |
| Reentrancy and callback starvation | debit before pay, in-flight marker, callbacks never panic |
| Donation inflation | only credited amounts enter the verdict; solvency check is `credited <= balance` |
| Intents Verifier force-withdraw | detect with `reconcile_intents`; minimise time in Intents; disclosed |

### C2 Pure logic crates
- **Purpose:** All math and rules that must be identical in the contract, the simulator and `verify.sh`.
- **Interface:** `kruxa-math` (`mul_div_floor`, `mul_div_ceil` returning `Result`, ppm fee split, `cap`, `vested`, epoch helpers, U256), `kruxa-types` (ids, Charter structs, merged `RuleCode`, `validate_charter`, `validate_ratchet`, events), `kruxa-logic` (verdict, allocation, phase, memo and msg parse, GenesisSpec compiler, Merkle, AMM math for the market wave), `kruxa-sim` (CLI: `verdict`, `settle`, `verify`, scenario runner).
- **Key data structures:** the canonical structs in RECONCILED section 3. One name constant: `PROJECT_NAME = "Kruxa"`, `EVENT_STANDARD = "kruxa"`, ticker constant `$KRUXA` kept separate.
- **Dependencies:** none beyond std and a U256 crate; `kruxa-math` has no near-sdk dependency so property tests run natively.
- **Constraints:** no floats; proptests 1 to 11 (S1-A 7.5); golden hash test; consistency test between the section-4 knob table and `validate_charter`.

### C3 Token provider
- **Purpose:** Create the launch fungible token at `create_trial`, verify it, and decide what happens to a dead token.
- **Interface:** trait with two implementations: `FactoryPrimitives` (`token.primitives.near` `create_token`, account `<symbol>.token.primitives.near`) and `OwnGlobalByHash` (global contract by code hash; built, not approved for use). `burn_mode`: `Burn | Sink(account) | Hold`.
- **Key data structures:** `TokenSpec` (symbol, name, decimals 6, metadata hash, route), `TokenState` (account, supply, expected code hash).
- **Dependencies:** factory contract; real cost and refund of `create_token` unproven live [OPEN: PULSE reports about 2.36 NEAR per token on `tkn.primitives.near`; S1-A and WINNER-BRIEF report about 0.05 NEAR on `token.primitives.near`; the two figures name different factories and are not reconciled].
- **Constraints:** supply is minted in full to C1 at `create_trial` and held there; the NEAR-side token therefore exists from the start of the trial, before any verdict. This is not hidden: the claim is about the Solana mint, not the NEAR token (INVARIANTS.md).

### C4 Intents intake
- **Purpose:** Turn NEAR USDC and Intents balances into ledger credits without trusting a relayer's claim about who paid.
- **Interface:** `ft_on_transfer` (msg `{"v":1,"op":"contribute","launch_id":"12","deliver":"near:<acct>|sol:<b58>","relay_fee":"<micro>","referrer":..}`, deny unknown fields, at most 512 bytes), `mt_on_transfer` (sender is the signer; guard predecessor, one token, USDC token id), S4 methods behind a feature flag.
- **Key data structures:** `CreditSource` (append-only: NativeNear unused, Nep141, IntentsNear, IntentsSolana), `DeliverTo` (Near or Solana, fixed at first contribution), relay fee counters in the ledger (not principal, never refundable).
- **Dependencies:** USDC contract, `intents.near`, 1Click quotes, Phantom `signMessage`. The trusted relayer path (`credit_intake`, S1) is NOT built unless S3 and S4 both fail verification and Dami agrees [RULED].
- **Constraints:** `min_gas` of 50 Tgas in the signed intent; Walk refunds go to the payer's own Intents account; relay fee carved inside the signed amount so the buyer sees the net before signing.

### C5 Market contract (Market-lite, pulled forward by CO-3)
- **Purpose:** The NEAR venue [RULED R-METEORA 2026-11-08]: Kruxa's own constant-product pool and fee router (`market.kruxa.near`), pulled forward from Wave 6 into the pre-freeze plan as "Market", with a mainnet path for $KRUXA and, once the capped beta opens, third-party launches. Own pool chosen as the fee router [RULED #13].
- **Scope split.** M-A (pre-freeze, needed for the market claim): one pool per launch, opened only by C1 `open_market`; `Buy` and `Sell` with mandatory `min_out`; a five-slice fee cut per swap from the Charter snapshot (constants in one file, section 4b); FeeLedger; creator slice claim paid to the payout recipient under the Charter fee-vest; platform withdraw; LP slice accrues to the pool; pause; per-pool and global reserve caps (DN-17); NEP-297 events for every swap, open and claim. M-B (Wave 6b): Hold Vault (until then the holder slice is redirected to LP, as ARCHITECTURE 5.1 already specifies), referral lots (until then the referral slice returns to LP), `lower_*` ratchets, opening-fee surcharge above base (start set equal to base), payee splits beyond one recipient.
- **Interface:** unchanged from ARCHITECTURE 5.1 (messages `OpenPoolToken`, `SeedQuote`, `Buy`, `Sell`; views). CO-3 adds ARCHITECTURE 5.8 to 5.13 (mainnet path, caps, events, deltas).
- **Constraints:** new money-holding code with NO independent review (R-34): mainnet only behind the M-gate (Nov 11 EOD) and a per-action confirmation, with reserve caps and a pause. `open_market` is never called inside `settle`. The NEAR pool LP is permanent inside the contract (D-20), so it needs no human timelock. Fee terms are in the Charter snapshot (ADR-014), so deploying core on Nov 11 and market on Nov 12 is safe. Core must already contain the `open_market` handoff when it is deployed, so the core wasm freezes on Nov 10 EOD (R-35).
- **Does not do:** cross-chain trading (a new token has no Intents quote), Solana-side fee income for the creator (zero until a Solana fee path exists), any price promise.
- **Dependencies:** C1, USDC, launch FT.

### C6 Hold Vault
- **Purpose:** Stake to earn holder-share rewards, instant unstake, 7-day claim gate (ruling #14).
- **Interface:** `Stake`, `unstake`, `claim_holder_rewards` inside the market wasm.
- **Key data structures:** `VaultPosition`, holder index, carry.
- **Dependencies:** C5.
- **Constraints:** Wave 6b (after the hackathon; Market-lite ships without it); accepts the UX cost of the 7-day gate; the creator-controlled-wallet bound in section 1.4 applies here.

### C7 Genesis relayer
- **Purpose:** Run the one-session Solana genesis after PASS and report back to NEAR.
- **Interface:** NEAR calls only through `genesis-relayer.kruxa.near` (function-call key limited to `commit_genesis`, `confirm_genesis`, `abort_genesis`); state machine `PASS_SEEN -> SPEC_VERIFIED -> G_CREATED -> G_FUNDED -> COMMITTED -> TX1_SIGNED -> TX1_CONFIRMED -> TX2_SIGNED -> TX2_CONFIRMED -> SELF_CHECKED -> CONFIRMED_ON_NEAR -> G_DESTROYED -> DONE`, failure edges to ABORTED.
- **Key data structures:** `GenesisPlan` (static, in the Charter), `GenesisState` (written at PASS), job events table, ceremony record (hash on NEAR).
- **Dependencies:** C1, Solana RPC (two providers), Metaplex, KMS in beta, memory in the demo.
- **Constraints:** mint is `createWithSeed(G_pub, seed)` (F1), known only at commit time; supply, authorities and bucket order fixed by the GenesisSpec; at most 7 holders per transaction, so more holders use the distributor. The TypeScript compiler must pass the same test vectors as the Python reference used by `verify.sh`. F0 (NEAR contract signs via `v1.signer`) is PRIMARY and F1 the fallback [RULED R-F0F1 2026-11-08]; F0 must pass a full rehearsal on NEAR testnet plus Solana devnet before the Nov 10 gate, else F1 ships and is disclosed.

### C8 Solana distribution
- **Purpose:** Let more than 7 Solana-origin backers receive tokens with one genesis transaction.
- **Interface:** Jito merkle distributor `new_distributor`, `new_claim`; Merkle tree over canonical-sorted leaves built from relayer-submitted ascending pages that C1 verifies against Positions (`build_root_page`).
- **Key data structures:** leaves of (pubkey, amount); `amount_locked` for vesting backer bonus; 90-day clawback to the community pool.
- **Dependencies:** Jito distributor `mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv` (immutable, audited, GPL-3.0 used as a deployed service via its IDL, no code copied).
- **Constraints:** `token_vault` must not pre-exist; admin set to a null admin; direct airdrop path if 12 or fewer Solana holders.

### C9 Squads reserve
- **Purpose:** Custody the reserve and LP-mirror buckets on Solana.
- **Interface:** Squads v4 multisig, one shared platform multisig with a vault index per launch.
- **Key data structures:** `CustodyRef { squads_multisig_hash, vault_index, disclosure: SinglePartyDemo | Independent2of3 }`.
- **Dependencies:** Squads v4 `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` (immutable; creation fee 0).
- **Constraints [RULED]:** demo: Dami holds all 3 keys on separate hardware wallets, disclosed as single-party. Before third-party creators open on mainnet (the capped beta): 2-of-3 with two named independents [OPEN: names; Dami: "when we get there", R-47]. Threshold at least 2 and a 48-hour time lock are kept even in the demo (the time-lock versus Genesis Round pace conflict is in section 9).

### C10 Verdict Rail
- **Purpose:** Publish a verified-launch attestation that any Solana app can read.
- **Interface:** Solana Attestation Service credential and schema; one attestation per settled launch carrying the NEAR verdict fields; `CloseAttestation` reclaims rent.
- **Key data structures:** schema fields equal NEAR values; `attest_log` of hashes on C1.
- **Dependencies:** SAS program `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` (upgrade authority a system account, owner unknown; deployed binary may predate the 2.0.0 repo version) [OPEN: S1-D O3, O10].
- **Constraints:** signed by the standing ATTEST key, disclosed. One attestation if time allows; the rest is Wave 7.

### C11 Verification tooling
- **Purpose:** Let a stranger recompute the headline claims.
- **Interface:** `./verify.sh <launch_id> [--near-rpc URL] [--sol-rpc URL]... [--evidence FILE] [--tamper NAME | --tamper-all] [--json]`; Python 3 standard library only; shells out to a prebuilt `kruxa-sim verify` for the NEAR-side recompute.
- **Key data structures:** check ids C1 to C28 and C30 (S1-D 7.2) plus C31 to C34 (verdict, book hash, ledger identities, market identity) [NEW per RECONCILED]. Exit codes: 0 verified, 2 mismatch, 3 pending, 4 infrastructure, 1 usage.
- **Dependencies:** C2, NEAR RPC, two Solana RPCs.
- **Constraints:** checks "is a mint and owned by the classic Token program", never "account is null"; tamper names: supply, mint-authority, freeze-authority, recipient-amount, spec-hash, metadata-uri, reserve-owner, root, bucket-extra, extension.

### C12 Web app
- **Purpose:** The user-facing product and the judge route (routes in section 7.4c).
- **Interface:** pages listed in `ROUTE-ARCHITECTURE.md`; reads C1 views and C14; wallet connect only for actions, never for reading.
- **Key data structures:** view models for launch, position, verdict margin ("PASS margin: $X and N backers"), funds-in-motion strip.
- **Dependencies:** C1, C14, C5, C22 (near-connect for NEAR, wallet-standard chooser for Solana).
- **Constraints:** no empty states, no login walls; the hosted instance holds no signing keys (keys-off-host path in section 7.5); stack is [ASSUMED] Next.js per the global default; design implementation belongs to the design phase, not this PRD.

### C13 Agent/API layer
- **Purpose:** Let agents read launches, verdicts and verification results.
- **Interface:** read-only JSON API, OpenAPI document, `llms.txt`, `AGENTS.md`, MCP server (tools: list launches, get launch, get verdict, run verify).
- **Key data structures:** the same view models as C12.
- **Dependencies:** C14, C11.
- **Constraints:** read-only in the slice. No agent can sign or spend. Counts toward the agents track only if the CONDITIONAL gate in section 1.6 passes.

### C14 Indexer
- **Purpose:** Read model for the launch feed, token pages, portfolio and event pages; own candles and trades; the independent fold of `book_hash`; an open launch dataset export (CSV and JSON).
- **Interface:** an `EventSource` with two implementations: `neardata` (`https://mainnet.neardata.xyz`, `https://testnet.neardata.xyz`; mainnet answered HTTP 200 after a redirect to a block JSON on 2026-11-08 [VERIFIED, read-only curl]; 2026 uptime history [UNVERIFIED]) and an RPC block scan for backfill and fallback. Store: SQLite (single node) or Postgres. HTTP read API with an OpenAPI file; `/api/candles` in a shape compatible with the TradingView datafeed so the Lightweight Charts component (Apache 2.0, attribution required) can be swapped later.
- **Key data structures:** event store, per-launch book fold, per-holder portfolio index, candles per interval, trades table. Core and market contracts emit a NEP-297 event for every buy, sell, pool open and fee claim so the indexer never diffs state.
- **Dependencies:** neardata or NEAR RPC. NEAR Lake is deprecated (2026-03-24) [VERIFIED: PULSE], so it is not used.
- **Constraints:** the indexer is a convenience; a judge can rebuild the fold from raw events with `verify.sh`, and the app degrades to direct RPC reads plus baked snapshots if the indexer is down.

### C15 Keeper and monitor
- **Purpose:** Run permissionless methods so nothing waits on a person, and watch solvency.
- **Interface:** `keeper.kruxa.near` holds no role and calls `settle`, `settle_positions_page`, `consolidate`, `sweep_residue`, `claim_refund` for others; runs `check_solvency` and alerts on `intents_alert`.
- **Key data structures:** job table.
- **Dependencies:** C1.
- **Constraints:** no keeper reward exists in v1 (ruling #31). Anyone else can do the same calls.

### C16 Signed-test kit and dry-run harness
- **Purpose:** Prove plumbing with throwaway keys and give judges a no-funds path.
- **Interface:** `warroom/signed-tests` (`npm run check`, `guard`, `preflight`, `test1.ts`, `test2.ts`, `sweep.ts`), `make sim`, fixtures, `scripts/hostile-preset.sh`, `scripts/intents-dry-quote.sh`.
- **Key data structures:** ledger state files with hard caps per step.
- **Dependencies:** throwaway keys kept in the scratchpad or env vars, never in the repo.
- **Constraints:** `npm run guard` fails if any token, mint, Metaplex or authority code exists outside the devnet-only T4 script. Test 2 (Chain Signatures) is done; Test 1 (Intents credit OV4 and `ft_withdraw` OV15) is prepared and NOT run [VERIFIED: no `test1.json` state file exists].

---

## 4b. Creator Earnings (CHANGE-ORDER-3)

Plain language first: a creator can earn from three places, and the contract decides when each becomes drawable. This section fixes who gets paid, when, and what is still undecided.

### 4b.1 Earnings sources and timing
| Source | Paid in | Starts | Cap or gate | Built |
|---|---|---|---|---|
| Proceeds stream | NEAR USDC | at PASS | `STREAM_CAP`: drawable(t) at most proceeds times elapsed over duration; zero before PASS | Wave 1 |
| Trade-fee creator slice | NEAR USDC | after `open_market` | Charter fee-vest (default 50% vests over 90 days); declared creator take at most 1.00% of volume | Market-lite (M-A) |
| Creator token allocation | launch token | PASS plus cliff | `R_ALLOC`, `R_VEST` (cliff at least 14 days) | claim path in Wave 1b or later |
| Solana-side fees | none | n/a | zero under F0/F1 until a Solana fee path exists | not built |

Nothing is earned before PASS; FAIL pays the creator and the platform 0.

### 4b.2 Payout recipient [RULED direction 2026-11-08]
1. **Default:** the account that signs `create_trial`. **Optional:** a separate recipient chosen at creation. Wave 1 already carries this as `stream_recipient: Option<AccountId>` defaulting to the creator (ARCHITECTURE 4.4, `lifecycle.rs`); CO-3 names it the **payout recipient** and extends it to market fee claims and allocation claims. No Wave 1 code change is needed for the stream.
2. **Fixed once the trial opens.** The submission build has no method that changes it. It appears in the Charter, on the trial page, in `preview_charter` and in the Creator Desk, and it is part of `charter_hash`.
3. **NEAR accounts only first.** The recipient must be registered on native USDC (`storage_balance_of`); the Studio warns before signing, and an unregistered recipient does not lose money because payouts are pull-based with re-credit (debit-before-pay, ADR-006).
4. **Post-freeze change flow (design, not in the submission build):** `propose_payout_change` by the current recipient, a 48 hour wait (same length as the Squads timelock), `accept_payout_change` by the new address, the old key may cancel during the wait, a "pending payout change" banner, changes apply to future draws only, and an optional `lock_payout_recipient` that is permanent. There is no platform override. Reason: pump.fun limited redirection to one change then a permanent lock after griefing, and Pons timelocks even its own takeover (research report, secondary reading [UNVERIFIED]).
5. **Per-chain payouts later:** a typed `{chain, address}` with a signed proof from the new address; withdrawal fees are shown and never sponsored. Solana-only creators stay out of scope until a fee-deducted relayer path exists.

### 4b.3 Fee split: RULED 50 / 15 / 15 / 10 / 10 (DN-15, R-46, 2026-11-08)
Dami: "go with your recommendation for the others" (the recommendation was option C). The ruled split is **50 creator / 15 platform / 15 holders / 10 locked LP / 10 referral** of a 1.00% typical fee (supersedes the earlier planned 35/20/20/15/10). Peers pay creators 35% to 70% of about 1%: Pons 70, Zora 50, Jupiter Studio 50, pump.fun curve 24 (research report 2026-11-08, secondary reading [UNVERIFIED]). Contract bounds are unchanged from PRODUCT-VISION-V2 section 4 (creator at most 60%, platform at least 15%, holders 10 to 30%, LP at least 5%, holders plus LP at least 20%, referral at most 20%, creator take at most 1.00% of volume, total fee at most 2.00%).

| Option | Creator / platform / holders / LP / referral | Creator take at 1.00% fee | Platform at 1.00% fee | Creator-controlled extraction bound | Status |
|---|---|---|---|---|---|
| A (earlier plan) | 35 / 20 / 20 / 15 / 10 | 0.35% | 0.20% | 80% | superseded |
| B | 45 / 20 / 15 / 10 / 10 | 0.45% | 0.20% | 75% | rejected (kept for the record) |
| **C (RULED)** | **50 / 15 / 15 / 10 / 10** | **0.50%** | **0.15%** | **75%** | **the default** |

Check [VERIFIED by arithmetic]: C satisfies every bound (sum 100, holders plus LP 25, creator 50 <= 60, platform 15 = floor, creator take 100 x 5,000 = 500,000 <= 1,000,000). Until the Hold Vault ships the holder slice goes to LP, so the effective LP share is 25%. All constants live in ONE place, `crates/kruxa-logic/src/rules.rs::FEE_SPLIT_DEFAULT`, are snapshotted into each Charter (so a later change cannot loosen an existing launch), and are mirrored in a generated `docs/constants.json` for the README. [SYNC 2026-11-10: the code uses `FeeTerms::standard()` and `Rules::ladder()`; no `docs/constants.json` exists; the hand-written `docs/OPEN-CONSTANTS.md` is the constants record, and `get_rule_set` is the live read] **Wave 1 consequence (CO-5):** the embedded Wave 1 code fixed the platform share at 20% (`Rules.platform_bps = 2_000`, rule `R_PLATFORM_FIXED`) and the standard preset at 30/20/20/25/5; both constants move to the ruled values (platform 1_500; preset 5_000/1_500/1_500/1_000/1_000) with no change to any rule logic or bound (ARCHITECTURE 4.1 and 4.2, CHANGE-ORDER-5 section 3). The code is not yet extracted or compiled, so this is a documentation change that the build applies and re-tests (GR-1) [UNVERIFIED until compiled].

### 4b.4 Exemption lists
Kruxa has no anti-sniper exemption list and no creator-controlled allowlist. If one is ever added: it is public, stored in the Charter, fixed at open, capped (interim cap 8 wallets [ASSUMED]), shown in `declared_wallets`, and never creator-controlled. Lesson: Pons V2 let a launcher exempt up to 32 wallets and an analyst alleges about $18M extracted through friendly wallets (single analyst source, no Pons response found [UNVERIFIED]).

### 4b.5 Revenue honesty (corrected)
The earlier research stated a monthly break-even of $16M at $80K cost. That is wrong at the planned share: $80,000 divided by a 0.20% platform share needs **$40M** of monthly volume (by arithmetic: 80,000 / 0.002 = 40,000,000); $16M works only at a 0.50% share (80,000 / 0.005); under the ruled split (0.15% platform) it needs about $53.3M. The PRD never carried the $16M, so this is a correction of `research/platform-buildout-research.md` (erratum appended). Meteora DBC takes 20% of trading fees before any partner share, which would shrink the platform slice further, and DAMM v2 has no platform/creator split of its own, so Kruxa must do that split (section 2.2 C17). At the $1,000 cap the launch fee is $15 (1.5%, minimum $10), so Phase 1 revenue is demonstration revenue. The only durable line is the 1.5% launch fee on PASS; grants and prizes fund runway. **No README or video line may claim break-even, sustainability or revenue** (INVARIANTS MUST NOT CLAIM).

### 4b.6 Creator Desk contents (pre-freeze)
Stream meter and draw (shows `STREAM_CAP`), fee claims once a market exists, payout recipient with registration status, earnings ledger with CSV export, declared wallets, pending changes banner (empty until the post-freeze flow).

---

## 5. API Contracts

External APIs the project calls. Each entry names its "unavailable" risk in section 7. Version pins live in `INVARIANTS.md` SOURCE LOCK. Testnet and mainnet differ only where stated. Intents has no testnet.

### A1 NEAR JSON-RPC
- **Base URL:** mainnet `https://rpc.mainnet.near.org` (legacy endpoint, worked 2026-11-06) or a hosted provider such as `https://free.rpc.fastnear.com`; testnet endpoint [UNVERIFIED, confirm at scaffold]. Overridable with `NEAR_RPC`.
- **Authentication:** none on public endpoints.
- **Rate limits:** unpublished [UNVERIFIED]; public endpoints throttle.
- **Calls used:** `query` (`view_account`, `view_code`, `call_function`), `tx` status, block and chunk reads for event folds.
- **Error handling:** two endpoints configured; any disagreement between endpoints on a read is exit code 4 (infrastructure), never a verdict.
- **Unavailable risk:** R-01.

### A2 NEAR Intents Verifier (`intents.near`)
- **Network:** mainnet only. Code hash pinned in the SOURCE LOCK.
- **Authentication:** signed intents (`raw_ed25519` for Phantom, NEP-413 for NEAR wallets); no API key.
- **Methods used:** `execute_intents`, `simulate_intents` (view), `mt_on_transfer` callback into C1, `mt_transfer`, `mt_balance_of` (solvency anchor), `ft_withdraw` (OV15 unproven).
- **Wire facts [VERIFIED: W0, source-read; live confirmation pending]:** notify is carried by flat `msg` and optional `min_gas` keys inside the transfer intent (no key named `notification`); `deadline` is an ISO-8601 string; nonce is base64 of 32 bytes or the versioned format; `signer_id` for a Solana key is the lowercase 64-hex of the public key; the signed bytes are the UTF-8 bytes of the `payload` string with no hashing or prefix.
- **Transfer intent shape (schema):**
```
{ "intent": "transfer", "receiver_id": "core.kruxa.near",
  "tokens": { "nep141:<usdc>": "<amount micro>" },
  "memo": "kruxa:v1:...", "msg": "<contract msg string>",
  "min_gas": "50000000000000" }
```
- **Callback facts:** balance moves to the receiver before `mt_on_transfer` runs; return `[0]` accepts, return the amounts to refund to the signer; a panic refunds everything. Predecessor is `intents.near`; no deposit attached.
- **Disclosed powers:** DAO-held `ft_force_withdraw`, `mt_force_transfer`, `mt_force_withdraw`, `force_lock_account`.
- **Unavailable risk:** R-02.

### A3 1Click API (NEAR Intents swap and bridge quotes)
- **Base URL:** per docs.near-intents.org (1Click section) [UNVERIFIED: confirm exact base URL from `scripts/intents-dry-quote.sh` at build time].
- **Authentication:** none for dry quotes; a partner JWT lowers the app fee from 0.25% to 0.20% (docs say 0.25% without a key and 0.20% with one; HACKATHON.md Q-006 says 0.2%) [VERIFIED: PULSE]. A non-python User-Agent header is required on all calls.
- **Endpoints used:** `/v0/quote` (with `dry:true` for judge paths, which return no deposit address), `/v0/status`, `/v0/tokens` (215 assets across 38 chains on 2026-11-05).
- **Request (schema, abbreviated):** `{ dry, swapType, originAsset, destinationAsset, amount, recipient, refundTo, depositType, refundType, deadline }`.
- **Response (success):** HTTP 201 with `amountOut`, `refundFee`, `withdrawFee`, and for live quotes a `depositAddress`.
- **Statuses:** `SUCCESS`, `REFUNDED`, `FAILED` (refund lands minus a flat fee). Observed waits 9-42 seconds [VERIFIED: warroom fact-check].
- **Fees seen:** USDC to USDC spread about 0.01%; SOL to USDC about 0.8%; exit flat fee about $0.24 when the destination has no USDC token account, about $0.01 when it has one (sample of 6, mechanism undocumented) [VERIFIED: S1-B 5.8].
- **Error handling:** non-201 aborts with nothing spent; refund and timeout states are shown to the buyer, never retried blindly.
- **Unavailable risk:** R-03.

### A4 Native USDC (NEP-141)
- **Account:** `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (6 decimals). Intents token id `nep141:` plus the same value.
- **Methods used:** `ft_transfer_call`, `ft_transfer`, `ft_balance_of`, `storage_deposit` (registration costs 0.00125 NEAR; `storage_balance_bounds` min equals max) [VERIFIED: S1-B 1.5].
- **Testnet:** a mock fungible token in the sandbox; a testnet USDC is [UNVERIFIED].
- **Unavailable risk:** R-04.

### A5 Token factory (`token.primitives.near`)
- **Methods used:** `create_token { args: { owner_id, total_supply, metadata } }` creating `<symbol>.token.primitives.near`.
- **Facts:** keyless tokens; code is a global contract with a publisher-updatable key; symbol validation returns "Invalid Symbol" for bad input; real cost and refund of excess deposit are not proven live; `ft_burn` presence unclear.
- **Error handling:** `on_token_created` failure sets `CreationFailed` and returns the deposit.
- **Unavailable risk:** R-05, R-33.

### A6 Chain Signatures (`v1.signer`)
- **Network:** mainnet; version 3.17.0; domain 0 secp256k1, domain 1 Ed25519, reconstruction threshold 10 [VERIFIED: S1-D V7].
- **Used in:** the T0-T5 plumbing proof; the policy-gated test contract; F0 upgrade path. Not in the shipped F1 genesis path.
- **Measured [PROVEN: signed test 2026-11-07]:** 20 of 20 signatures, p50 13.5 s, p95 15.1 s, max 15.7 s (end to end, including NEAR finality); a 1,150-byte payload signs; a contract-initiated sign with a policy gate accepted the matching message and refused a mismatched one.
- **Unavailable risk:** R-06.

### A7 Solana JSON-RPC
- **Base URL:** `https://api.mainnet-beta.solana.com` (public, rate-limited), devnet with airdrop for rehearsals; a second provider is configured for the two-RPC agreement rule. Overridable with `SOL_RPC`, `SOL_DEVNET_RPC`.
- **Calls used:** `getAccountInfo`, `getTokenSupply`, `getSignaturesForAddress`, `simulateTransaction` (`sigVerify:false`, `replaceRecentBlockhash:true`), `getMinimumBalanceForRentExemption`, `getRecentPrioritizationFees`.
- **Error handling:** two RPCs must agree at `finalized`; disagreement is exit 4.
- **Unavailable risk:** R-07.

### A8 Squads v4
- **Program:** `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`, immutable; multisig creation fee 0 [VERIFIED: S1-D V3]. Audits cited: Neodyme (2023); a Trail of Bits audit is secondary-sourced. Repo licence AGPL-3.0.
- **Used for:** reserve and LP-mirror custody; threshold, time lock and member set checked by `verify.sh` C12.
- **Unavailable risk:** R-08.

### A9 Jito merkle distributor
- **Program:** `mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv`, immutable, audited by Neodyme and OtterSec per its repo; GPL-3.0, so used as a deployed service only.
- **Used for:** `new_distributor` (PDA `["MerkleDistributor", mint, version]`), `new_claim`; clawback at least one day after end.
- **Open:** byte cost of `new_distributor` plus `set_admin` inside tx2, `set_admin` to a non-signable key, leaf hash layout (S1-D O1, O2, O4).
- **Unavailable risk:** R-09.

### A10 Metaplex Token Metadata
- **Program:** `metaqbxx...` (immutable); creation fee about 0.01 SOL, measured by simulation (metadata account total 13,733,800 lamports) [VERIFIED: S1-D V4].
- **Used for:** immutable metadata (`is_mutable` false, no creators, `sellerFeeBasisPoints` 0).
- **Unavailable risk:** R-10.

### A11 Solana Attestation Service (SAS)
- **Program:** `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`; seeds `credential`, `schema`, `attestation`; no protocol fee, rent only (about 2,656,840 lamports for 222 bytes, reclaimable by `CloseAttestation`).
- **Open:** the deployed binary may predate repo version 2.0.0; ownership of the upgrade authority is unknown (S1-D O3, O10).
- **Unavailable risk:** R-11.

### A12 Phantom wallet `signMessage`
- **Used for:** buyer-signed Intents payloads and `walk_signed` messages.
- **Open:** byte-exactness of what Phantom signs, display of a JSON payload of this size (OV3); folded into the Test 1 run.
- **Unavailable risk:** R-12.

### A13 AWS KMS (Ed25519)
- **Used for:** genesis key G custody in the capped beta; not in the demo (memory-only). Ed25519 support added Nov 2025 [VERIFIED: S1-D V10].
- **Open:** key spec name, message size limit, and deletion wait (7-30 days) versus the word "destroyed" (S1-D O8, O11).
- **Unavailable risk:** R-13.

### A14 Solana venue: Meteora DAMM v2 and DBC, with the Raydium CPMM and Orca fallbacks [CO-3, CO-5, UNVERIFIED]
Used only by the venue service C17. Program ids, IDLs and fee constants are read from Meteora's docs and the deployed IDL in spike S-M0; nothing here is trusted from memory. Facts from the research report (primary pages cited there, not re-fetched by this change-order): locked liquidity still earns claimable fees; DBC takes 20% of trading fees first. Failure of the spike falls back to NEAR-pool-only trading, then Raydium CPMM with burned LP, then Orca Whirlpools (DN-22; source `research_notes/Kruxa launchpad market layer fees/meteora_fallback.md`). Switch triggers: mint rejected or no pool after about a day of debugging; lock or fee claim fails; pool not routable or listed within about 24 h of a tiny mainnet pool; exploit, pause or breaking upgrade. Disclosures: upgrade authorities of Meteora, Raydium and Orca are unverified (single key or multisig unknown) [UNVERIFIED]; a PDA or Squads-vault-owned position claiming fees is untested until the devnet spike [UNVERIFIED]; DexScreener and GeckoTerminal auto-listing of new pools is unconfirmed [UNVERIFIED].

### A15 neardata and NEAR RPC (indexer) [CO-3]
`GET https://{mainnet|testnet}.neardata.xyz/v0/last_block/final` redirects to `/v0/block/{height}`; mainnet returned 200 on 2026-11-08 [VERIFIED]. Fallback: RPC `block`, `chunk` and `EXPERIMENTAL_tx_status` scans.

### Contract message formats (specs, not code)
| Message | Fields | Limits |
|---|---|---|
| `ft_on_transfer` / `mt_on_transfer` `msg` | `v` (1), `op` ("contribute"), `launch_id` (string u64), `deliver` ("near:<account>" or "sol:<base58>", optional for NEAR payers), `relay_fee` (micro-USDC string), `referrer` (optional) | unknown fields rejected; at most 512 bytes |
| `walk_signed` message | `kruxa:walk:v1\|<contract id>\|<launch id>\|<payer>\|<nonce>\|<deadline>` | verified with `ed25519_verify` over the exact bytes |
| S4 memo | `kruxa:v1:t=<id>;d=<deliver>;fee=<micro>` | well under the 16 KB event-log ceiling (under 200 bytes) |

---

## 6. Demo Script

**Total Duration:** 3:00 (180 seconds). Brief range for the template is 3-5 minutes; the WINNER-BRIEF demo obligation sets 3 minutes.
**Format:** screen recording plus voiceover, then cut for the X post. Dami approves before anything is posted.
**Environment label shown on screen for every scene:** `NEAR TESTNET + SOLANA DEVNET` unless a scene says RECORDED (mainnet plumbing receipt) or MAINNET (Genesis Round, only if GO).
**Rule for this script:** no fabricated state. Pre-run launches are labelled "opened earlier" with tx hashes. Any Solana step not run live is labelled DRY-RUN. Any mainnet receipt is labelled RECORDED.

Each scene lists the flow it covers.

### Scene 1: The number (0:08)
**Covers:** none (framing).
**Screen:** landing page hero with the 0.63% figure and the one-line product statement.
**Voiceover:** "Most token launches lose money. Under one percent graduate. Kruxa gives buyers an exit before the verdict."
**Action:** none.

### Scene 2: A hostile preset is refused, a valid one opens (0:18)
**Covers:** Flow 1.
**Screen:** Studio. Preset editor with creator allocation set to 60% and window set to zero. Red rule codes appear. Then a valid preset; the trial page opens with transaction hash.
**Voiceover:** "Maya sets her creator share to 60 percent. The contract refuses it with R_ALLOC and R_WINDOW. She fixes the preset and opens the trial."
**Action:** `preview_charter` view, then `create_trial` on testnet.

### Scene 3: A NEAR buyer commits (0:12)
**Covers:** Flow 2.
**Screen:** Trial page, commit box, USDC amount, confirmation, backer count moves.
**Voiceover:** "Priya commits USDC from NEAR. The ledger records it and the book hash updates."
**Action:** `ft_transfer_call` on testnet.

### Scene 4: A Solana buyer commits through Intents (0:30)
**Covers:** Flow 3.
**Screen:** Phantom prompt with the quoted relay fee and net amount. Split screen: sandbox run of the signed transfer reaching `mt_on_transfer`, and a refund-on-reject run. Label: `SANDBOX` on the live part, `RECORDED, MAINNET` on the Intents receipt (only if signed Test 1 ran; otherwise the dry quote labelled `DRY QUOTE, no funds`).
**Voiceover:** "Kofi holds only Phantom. He sees the relay fee and the net amount, signs one message, and anyone submits it. If the contract rejects the deposit, Intents sends it back to Kofi. The platform pays no gas for him."
**Action:** recorded receipt plus sandbox run.

### Scene 5: Walk (0:16)
**Covers:** Flow 4.
**Screen:** Walk sheet text, confirm, total active drops, backers drop by one, refund line appears.
**Voiceover:** "Any buyer can walk until the deadline. The principal returns to their own account. A relay fee, if they paid one, stays spent. Moving to a Solana wallet costs an Intents fee, shown before they sign."
**Action:** `walk` then `claim_refund`.

### Scene 6: Settle returns PASS (0:16)
**Covers:** Flow 5.
**Screen:** Trial A at deadline; `settle` call; verdict panel with inputs, margin and hash; `kruxa-sim verdict` prints MATCH.
**Voiceover:** "At the deadline anyone can settle. The verdict uses three numbers and no judgment. Here it passes, and the simulator recomputes the same answer."
**Action:** `settle`, then `kruxa-sim verdict` recompute.

### Scene 7: Settle returns FAIL and everyone is refunded (0:12)
**Covers:** Flow 6.
**Screen:** Trial B settles FAIL with reason BELOW_MIN_FUNDERS; refunds paid; Solana explorer shows the address as not found.
**Voiceover:** "Trial B misses its minimum backers. It fails, every buyer is refunded, and the Solana address never becomes a mint."
**Action:** `settle`, `claim_refund`, explorer view.

### Scene 8: The creator cannot take it all (0:14)
**Covers:** Flow 7.
**Screen:** Backer claims tokens. Creator presses Withdraw all; the call reverts with STREAM_CAP; stream meter shows the allowed amount.
**Voiceover:** "After a pass, the creator draws at a fixed rate. Withdraw all reverts with STREAM_CAP."
**Action:** `claim_tokens`, `draw`.

### Scene 9: Solana genesis after the pass (0:18)
**Covers:** Flow 8.
**Screen:** Devnet explorer for the Trial A mint: owner is the Token program, mint authority None, freeze authority None, metadata immutable. Distributor account and Merkle root shown.
**Voiceover:** "Only after the pass does the token exist on Solana. Mint and freeze authority are empty from the first moment. Backers claim from a Merkle distributor."
**Action:** devnet genesis ceremony replay (recorded, labelled).

### Scene 10: Anyone can check it (0:18)
**Covers:** Flow 9.
**Screen:** Terminal: `./verify.sh <launch_id>` prints PASS lines and `VERIFIED`; then `--tamper-all` prints MISMATCH lines and exits 2.
**Voiceover:** "One command checks the verdict, the book, the mint and the distribution with no keys. Change one value and it fails."
**Action:** run both commands.

### Scene 11: The Genesis Round (0:12)
**Covers:** Flow 10.
**Screen (GO):** Kruxa brand-token trial page with the banner "Genesis Round: capped launch, no independent audit, reserve held by one person", caps $1,000 per launch, tx hashes, label `MAINNET`.
**Screen (NO-GO):** card "Genesis Round moved past the hackathon" with the gates that were not green.
**Voiceover (GO):** "Kruxa's own token goes through the same trial, capped at one thousand dollars. No audit yet, and we say so."
**Voiceover (NO-GO):** "Kruxa's own launch waits for the gates. Everything you saw ran on testnet and devnet."
**Action:** show page.

### Scene 12: Close (0:06)
**Covers:** none (framing).
**Screen:** repo URL, the disclosures list, "Built at NEAR HACKATHON", handle and hashtag text for the post.
**Voiceover:** "Kruxa. Built for NEAR HACKATHON."
**Action:** none.

Scene total: 8+18+12+30+16+16+12+14+18+18+12+6 = 180 seconds.

**Voice and copy compliance check (done):** no em dashes; no buzzwords; active voice; terms explained at first use. YouTube-style title limit not applicable (the video goes on X). X post text and any title are produced in the demo phase, in Dami's voice, and posted only after Dami approves.

### Demo Prerequisites

Seed state table. `scripts/seed-demo` (language fixed in the Architecture phase) must produce this state from scratch and be idempotent.

| Item | Value | Network / Location | Created By |
|---|---|---|---|
| Core contract (rehearsal) | `core` account under a testnet root [ASSUMED name `core.kruxa.testnet`] | NEAR testnet | seed script |
| Demo account (same wasm, relaxed RuleSet: min commit 90 s, min tail 30 s) | `demo` account [ASSUMED name] | NEAR testnet | seed script |
| Launch A (PASS) | hard cap $5,000, soft cap $1,500, 40 backers, sigma $2,000 | testnet, mock USDC | seed script |
| Launch B (FAIL) | same terms, 6 backers (below the minimum of 25) | testnet | seed script |
| Launch C (live, open) | open trial the viewer can walk from; relaxed demo timing | testnet | seed script |
| Devnet mint for Launch A | null mint and freeze authority, classic Token program, 82 bytes | Solana devnet | genesis relayer |
| Solana address for Launch B | absent | Solana devnet | none (stays absent) |
| Recorded plumbing receipts | T1b Solana mainnet transfer signature `2AJfSjNKfCrdw6fN7DM1XKDrrCsbbgu4hz9ULBUWNna9QrbarLnMTxBiyEFkKr5adXon4qiWUfsEUVvrHqmKuwWd`; T5c NEAR mainnet tx `9GCxnLUubUrpJqvDrfyhLc3hga45rZSreJ46jzcmGDZn`; T4 devnet mint `rktRrftPETTotHEf3jLTPSJQ1bPv6oFoBQFGEQzhEHz` | mainnet and devnet | already exist (signed test 2) |
| Recorded Intents receipt (OV4) | only if signed Test 1 runs | mainnet | Test 1 (not run) |
| Genesis Round trial | only on GO | mainnet | Dami, per-action |

**Invariant:** running the seed script from the project root yields this state from scratch and is safe to run again. The deployed site shows this state with no wallet connected.

---

## 7. Risk Register

Severity scale: CRITICAL (kills the submission or the claim), HIGH, MEDIUM, LOW. "Decision tree" points to the DT list below the table; DT texts are expanded in the Implementation Plan (Phase 3).

| # | Category | Risk | Severity | Likelihood | Impact | Mitigation | DT |
|---|---|---|---|---|---|---|---|
| R-01 | Technical | A1 NEAR RPC unavailable or rate-limited (the mainnet endpoint is a legacy one) | MEDIUM | MEDIUM | Indexer and `verify.sh` stall | Two configured endpoints, `NEAR_RPC` override, exit 4 on disagreement, `--evidence` replay with recorded responses | DT-5 |
| R-02 | Technical | A2 `intents.near` unavailable, paused, or an account is force-locked | HIGH | LOW | Solana buyers cannot commit or walk; Intents-held escrow could be removed | `reconcile_intents` tripwire sets `intents_alert` and refuses new Intents commits; time in Intents minimised by `consolidate`; disclosure | DT-2 |
| R-03 | Technical | A3 1Click API unavailable, key required, or quote behaves differently when live | MEDIUM | MEDIUM | Entry quotes fail; judge dry-quote step fails | Dry quotes need no key; recorded receipts; Solana buyers can also bring USDC already held in an Intents account | DT-2 |
| R-04 | Technical | A4 USDC contract upgrades or pauses | LOW | LOW | All commits and payouts stop | `R_UNEXPECTED_TOKEN` guard; PAUSED keeps exits open; monitoring | DT-1 |
| R-05 | Technical | A5 factory unavailable, or real `create_token` cost differs from specs (0.05 NEAR versus about 2.36 NEAR reported) | HIGH | MEDIUM | `create_trial` fails or costs more than the deposit formula; the first mainnet cost is observed at the brand launch | Testnet factory call in Wave 0; `required_deposit` is a view; deposit refund of excess; `CreationFailed` path returns the deposit | DT-1 |
| R-06 | Technical | A6 `v1.signer` unavailable | LOW | LOW | F0 upgrade path blocked; shipped F1 path unaffected | F0 is optional; no claim of F0 control beyond T0-T5 | DT-4 |
| R-07 | Technical | A7 Solana public RPC unavailable or rate-limited | MEDIUM | HIGH | Genesis and `verify.sh` stall during the ceremony or judging | Two providers, `SOL_RPC` override, finalized reads, recorded evidence | DT-3 |
| R-08 | Technical | A8 Squads v4 unavailable or instruction layout differs | MEDIUM | LOW | Reserve vault cannot be created | Devnet test N-13 before launch; fall back to a documented single-signer vault for the demo, disclosed | DT-3 |
| R-09 | Technical | A9 Jito distributor unavailable or byte cost does not fit tx2 | HIGH | MEDIUM | More than 7 Solana holders cannot be served in one genesis | Open verifications O1, O2, O4 on devnet; direct airdrop path for 12 or fewer holders; cap holders in the demo | DT-3 |
| R-10 | Technical | A10 Metaplex metadata account creation changes fee or signer rules | LOW | LOW | Genesis simulation fails | Recheck by simulation each release (O5) | DT-3 |
| R-11 | Technical | A11 SAS unavailable or deployed binary differs from the repo | MEDIUM | MEDIUM | Verdict Rail attestation cannot be published | Rail is optional in the slice; devnet round trip with the dumped binary before publishing | DT-3 |
| R-12 | Technical | A12 Phantom `signMessage` does not sign byte-exact UTF-8 or rejects the payload size | HIGH | MEDIUM | Phantom-only buyers cannot commit or walk | One micro-test in signed Test 1; `walk_signed` message kept short; S4 fallback | DT-2 |
| R-13 | Technical | A13 AWS KMS Ed25519 limits (message size, deletion wait) | LOW | MEDIUM | Beta custody plan changes | Demo uses memory-only G; README wording "deleted" not "destroyed" until the wait is understood | DT-4 |
| R-14 | Technical | Stream-lite, settle and refund not green by the Nov 8 EOD gate | CRITICAL | MEDIUM | Product reads as a bare refundable pre-sale; WINNER-BRIEF R1 | Gate G1 on Nov 8 EOD; STOP and re-plan, cut order in section 8; never ship the bare floor as the launchpad | DT-1 |
| R-15 | Technical | New near-sdk-rs async model (promises, callbacks) and U256 math cause bugs | HIGH | MEDIUM | Money-moving bug | Rust experience (VaraCore) transfers; pure math crate with property tests; debit-before-pay pattern; adversarial suite; ledger identities asserted every step | DT-1 |
| R-16 | Technical | S3 behaves differently on mainnet than the source reading (OV1 live), including pre-v0.4.2 field names | HIGH | LOW | Trustless path fails; falls to S4 | Source-verified and simulate-accepted; live micro-test in Test 1; S4 behind a feature flag; relayer path only with Dami's agreement | DT-2 |
| R-17 | Technical | OV15 `ft_withdraw` to Solana fails or is inconclusive | HIGH | MEDIUM | No Solana-landing exit claim | Drop every Solana-landing claim; describe Walk as refund to the Intents account | DT-2 |
| R-18 | Technical | Genesis compilers disagree (TypeScript relayer versus Python reference), or transaction exceeds 1,232 bytes | HIGH | MEDIUM | Wrong mint, or ceremony cannot fit | Shared test vectors; Python is the reference; simulate before sending; at most 7 holders per transaction, claim-based beyond that | DT-3 |
| R-33 | Technical | Factory token has no `ft_burn`; dead-token handling unclear | MEDIUM | MEDIUM | A dissolved launch leaves supply in core | `burn_mode` (`Burn`, `Sink`, `Hold`); testnet check in Wave 0 | DT-1 |
| R-19 | Competitive | Calyx (Aurora launchpad on NEAR Intents), meme.cooking and Tripwire are close neighbours | MEDIUM | HIGH | Judges see a launchpad again | The pitch is the Walk plus verdict-gated existence on Solana, not "a launchpad"; no "first" or "novel" claim | DT-5 |
| R-20 | Competitive | 132 roster entries on 2026-11-05 and many AI-and-money entries; judges have seen similar launchpads | HIGH | HIGH | Low differentiation score | Working value-movement demo with recomputable verification, honest disclosures, and the Genesis Round as a real product proof | DT-5 |
| R-21 | Time | One builder, seven days, scope across contract, Solana side, app, verify and video | HIGH | HIGH | Cuts at the freeze | Floor frozen on Nov 8; cut order in section 8; Market-lite is pulled forward (CO-3) behind its own M-gate and sits late in the cut order | DT-1 |
| R-22 | Time | Genesis Round does not fit before the deadline: 24-hour minimum commit window, 1-hour tail, a 48-hour Squads time lock for LP seeding | HIGH | HIGH | LP seeding or the whole launch lands after Nov 14 | Open the trial by Nov 11 12:00 UTC (latest 18:00); the 48 h lock is kept (R-GR-TIME) and a late release is disclosed; otherwise move the launch past the hackathon (Nov 10 go/no-go); date math in section 8.3 | DT-4 |
| R-32 | Time | Every signature, deploy and spend needs Dami's per-action confirmation | MEDIUM | HIGH | Waiting stalls the chain of steps | Batch confirmation requests at fixed times; prepare each step as a dry run first | DT-4 |
| R-23 | Demo | Intents waits (9-42 s) or an RPC stall break a live take | MEDIUM | MEDIUM | Failed recording | Recorded receipts labelled RECORDED; sandbox runs; two full takes | DT-6 |
| R-24 | Demo | Judges expect mainnet; our rehearsals are testnet and devnet because no other token or mint may exist on mainnet before the brand launch | HIGH | HIGH | Read as "not real" | Testnet is eligible for every track (Q-010); recorded mainnet plumbing proof; the Genesis Round is the mainnet proof if GO | DT-4 |
| R-31 | Demo | Submission is one shot and cannot be edited | HIGH | LOW | A typo or a broken link is permanent | Preflight run on Nov 13; submit Nov 14 with margin; payload shown to Dami first | DT-6 |
| R-25 | Judging | An AI judge cannot reproduce the README (funds, waits, Solana half) | CRITICAL | MEDIUM | Reproducibility score collapses (the weakest leg) | No-funds path for every numbered step; fresh-agent README run on Nov 12 from a clean checkout; clock as a parameter; recorded evidence | DT-5 |
| R-26 | Judging | Headline overclaims ("creator takes at most 1%", "100% back", Chain Signatures control, "first") | HIGH | MEDIUM | Credibility loss, possible elimination | INVARIANTS.md MUST NOT CLAIM list; headline deferred; claims recomputable from committed sources | DT-5 |
| R-27 | Judging | Review gap, single-party reserve and publisher-updatable factory token read as rug risk | HIGH | MEDIUM | Trust penalty | Disclose first, on the landing page and charter page; caps; labelled round; ladder to a reviewed beta | DT-4 |
| R-30 | Judging | Legal posture for a token launch (securities, sanctions, US persons) is not settled [UNVERIFIED] | HIGH | MEDIUM | Reputational or legal exposure | Caps, labelled round, risk disclosure, geoblock first; counsel is a launch-ladder gate, not a hackathon deliverable | DT-4 |
| R-28 | Scope | Feature creep into market, Hold Vault or roadmap modules before the core gate | HIGH | HIGH | Core slips | Roadmap modules stay sequenced after Wave 4 except Market-lite, the indexer and tier A and B track modules (CO-3); waves have hard gates and the cut order is in section 8.4 | DT-1 |
| R-29 | Scope | The Genesis Round pulls effort from the judge route, verify and README | MEDIUM | HIGH | Weaker submission | The Genesis Round runs only after the Nov 10 go/no-go; README and fresh-agent run are not cut for it | DT-4 |
| R-34 | Technical | Market-lite is new money-holding code with no independent review | HIGH | MEDIUM | Loss of pool funds | Mainnet only behind the M-gate and a per-action confirmation; per-pool and global reserve caps (DN-17); mandatory `min_out`; pause; ledger identities asserted per swap; disclosure on `/charter` | DT-9 |
| R-35 | Time | Core wasm must freeze on Nov 10 EOD, because it is deployed Nov 11 and must already hold the `open_market` handoff and the creator gate | HIGH | MEDIUM | A mid-trial core upgrade, or no NEAR market at the Genesis Round | Handoff built and tested against a market stub by Nov 10; fallback: market stays testnet, LP seed stays in core, disclosed | DT-9 |
| R-36 | Time | Capacity: 15.35 agent-days of pre-freeze demand against 15.2 usable (PLAN) | HIGH | HIGH | Cuts at the freeze | Section 8.4 cut order fires from the top; tier C never starts before the M-gate | DT-10 |
| R-37 | Scope | BLK-1: Squads independents unnamed | HIGH | HIGH | Capped beta cannot open | Owner Dami ("when we get there", R-47); plan latest Nov 11 EOD; not needed for the Genesis Round; fallback closed beta, testnet open | DT-8 |
| R-38 | Technical | Meteora spike fails, or the Solana LP seed cannot leave NEAR in time (48 h timelock plus unproven OV15) | HIGH | MEDIUM | No Solana pool by Nov 14 | NEAR pool first (100% of the round-one LP seed, DN-14 RULED); fallback tree Raydium CPMM then Orca Whirlpools (DN-22); disclose what lands after Nov 14 | DT-7 |
| R-39 | Technical | neardata uptime unknown and the host dies before Nov 18 or Nov 25 | MEDIUM | MEDIUM | Charts and feed stale | RPC scan fallback; app degrades to baked snapshots and direct reads; tier 2 hosting | DT-5 |
| R-40 | Judging | Listing a track whose step does not run at freeze | HIGH | MEDIUM | Credibility loss | Rule F-TRACK and `claimed-tracks.sh`; recheck at preflight | DT-5 |
| R-41 | Technical | Third-party creator abuse on mainnet (wash trading, rug within caps, exemption abuse) | HIGH | MEDIUM | Reputational harm | Caps; no exemption lists; Walk; verdict; one active trial per account; takedown log; pause | DT-4 |
| R-42 | Technical | near-connect is unverified at runtime, and look-alike package names exist | MEDIUM | MEDIUM | Wallet connect fails | Pin exact version and publisher; fallback to the built wallet-selector | DT-5 |
| R-43 | Judging | A revenue or break-even claim slips into the README or video | MEDIUM | MEDIUM | Credibility loss | INVARIANTS MUST NOT CLAIM; section 4b.5 | DT-5 |
| R-44 | Technical | Payout recipient not registered on USDC, or a typo address | MEDIUM | MEDIUM | Draw or claim fails or the creator misses money | Studio registration check; pull payouts with re-credit; recipient fixed at open so a wrong value is caught before commits | DT-1 |
| R-45 | Judging | Legal exposure from opening mainnet to third-party creators without review or counsel | HIGH | MEDIUM | Legal or reputational harm | Caps; terms and risk disclosure; geoblock; counsel read on fees from escrow and holder pools before any cap increase (DN-13) | DT-4 |
| R-46 | Technical | Sandwich or ordering exposure on the NEAR pool | MEDIUM | MEDIUM | Traders lose to ordering | Mandatory `min_out`; caps; disclosure | DT-9 |

Risk count: 46 (R-01 to R-46; R-34 to R-46 added by CHANGE-ORDER-3). All six categories covered: Technical (R-01 to R-18, R-33), Competitive (R-19, R-20), Time (R-21, R-22, R-32), Demo (R-23, R-24, R-31), Judging (R-25, R-26, R-27, R-30), Scope (R-28, R-29).

Decision trees (expanded in the Implementation Plan):
| DT | Trigger | Branches |
|---|---|---|
| DT-1 | Wave 1 gate G1 (Nov 8 EOD) red | cut order: portfolio views, `audit_page`, own-FT route, `claim_refund_batch`; if stream-lite or settle or refund still red, STOP and re-plan |
| DT-2 | Intents behaviour (OV1, OV3, OV4, OV15) | S3 passes: ship S3. S3 fails and S4 passes: ship S4. Both fail: ask Dami before any relayer path. OV15 fails: drop Solana-landing claims |
| DT-3 | Solana side blocker (distributor, Squads, SAS, size) | fall back to direct airdrop for 12 or fewer holders; drop the Rail attestation; keep genesis, authorities and `verify.sh` |
| DT-4 | Nov 10 go/no-go (moved from Nov 11) and Dami's confirmations | GO: Genesis Round on mainnet under caps. NO-GO: launch moves past the hackathon; submission stands on testnet/devnet plus recorded receipts |
| DT-5 | Reproducibility or overclaim finding | fix the README step or remove the claim; never relax an invariant |
| DT-6 | Recording or submission preflight fails | retake; use recorded evidence; hold the submit until green, with Nov 14 margin |
| DT-7 | Meteora spike result (Nov 10 midday) | DAMM v2 checks pass: venue GO for the Solana pool builder. Any DAMM v2 check fails (mint rejected, no pool after about a day of debugging, lock or fee claim fails, or a PDA/Squads-owned position cannot claim fees): NEAR pool only for round one, then Raydium CPMM with burned LP, then Orca Whirlpools (DN-22); Kruxa does the platform/creator split itself on any venue. DBC stays off unless all four DBC checks pass |
| DT-8 | BLK-1 Squads independents unnamed by Nov 11 EOD (third-party creators only; the Genesis Round does not need them) | beta stays closed (`creator_gate` closed), testnet stays open to all, the single-party vault stays disclosed; independents can be added later by a Squads config transaction |
| DT-9 | M-gate (Nov 11 EOD, see the gate table in 9.3) red | Market-lite stays on testnet; the $KRUXA LP seed stays in core and `open_market` waits for a core upgrade or the next window; disclosed |
| DT-10 | Capacity: any day over budget (PLAN) | fire the cut order in section 8.4 from the top; never cut a never-cut item |

### Risk Categories Covered
- [x] Technical risks (R-01 to R-18, R-33)
- [x] Competitive risks (R-19, R-20)
- [x] Time risks (R-21, R-22, R-32)
- [x] Demo risks (R-23, R-24, R-31)
- [x] Judging risks (R-25, R-26, R-27, R-30)
- [x] Scope risks (R-28, R-29)

---

## 7.4b USER-FIRST: the real user model

Full document: `USER-ONBOARDING.md`. This summary fixes the law for real users, separate from the judge route.

| User class | WHO | First arrival | Path to value |
|---|---|---|---|
| Creator | Anyone with a NEAR account and a token idea (Maya; for the Genesis Round, Dami) | Studio, no wallet needed to preview | Pick a preset, see rule codes live, create the trial with the bond |
| NEAR buyer | Holds USDC on NEAR (Priya) | Trial page from a shared link | `ft_transfer_call` commit, walk any time before the deadline |
| Solana-only buyer | Holds SOL or USDC on Solana, only Phantom (Kofi) | Trial page from a shared link, connects Phantom | 1Click entry to his own Intents account, one signature for commit, one for Walk |
| Verifier | Judge, auditor, journalist or agent | Landing page, no login | Reads the trial page, runs `verify.sh`, no keys |
| Operator | Dami (platform owner, keeper runner, guardian) | Private runbook | Runs keepers, genesis ceremony, pause if needed |

Cold-stranger genesis: a stranger with no prior setup opens the landing page, sees a real testnet/devnet launch with transaction hashes, reads the verdict inputs, and runs a dry quote or `verify.sh` without a wallet or login. To act, they connect a wallet at the moment of action only.

User path (not the demo's):
- REAL: create, commit, walk, settle, claim on the same contracts the demo uses.
- DEMO: the demo runs the same path on the labelled demo account (same wasm, relaxed time bounds, ruling #32). There is no always-on "simulate success" button. Dry-run buttons are labelled and return the same shape of output as the real call.

## 7.4c ROUTE ARCHITECTURE

Full document: `ROUTE-ARCHITECTURE.md`. Multi-page, derived from the user classes above, landing page required.

| Route | Purpose |
|---|---|
| `/` | Landing: one-line statement, the number, a live launch card, honesty strip |
| `/launches` | Launch feed and Verdict Board: stage tabs (Live trials, Just passed, Trading, Failed or refunded), name, symbol and ID search, time to verdict |
| `/token/[id]` | Token page: Lightweight Charts on own candles, trades feed, buy and sell panel (NEAR pool), each chain's price and depth with "not executable across chains" |
| `/launch/[id]` | Trial page: inputs, margin, commit, Walk, verdict, genesis state, events |
| `/launch/[id]/verify` | Per-launch verification page with the `verify.sh` command and recorded output |
| `/create` | Studio: presets, live rule codes, create |
| `/portfolio` | Positions, funds in motion, claims |
| `/creator` | Creator Desk: stream meter and draw, earnings and fee claims, payout recipient and its USDC registration status, CSV export, declared wallets |
| `/charter` | Disclosures: custody, review gap, factory token, Intents powers, caps, limits |
| `/proof` | Judge proof artifacts: signed-test results, hashes, explorer links [SYNC 2026-11-10: REMOVED. Dami ruled there is no `/proof` page: Kruxa is a real launchpad, not a judge showcase. Recorded receipts live in `evidence/` and the docs; the tamper toggle is at `/launch/[id]/verify`] |
| `/demo` | Separate judge and demo route: seeded launches, scripted steps, labelled [SYNC 2026-11-10: REMOVED by the same ruling; Discover at `/` shows the seeded launches] |
| `/api`, `/llms.txt`, `/agents` | Agent and API layer, including `/api/check` (Launch Check) and candles |
| `/beta` | Capped-beta status: open or closed, caps, blocker status (BLK-1), how to create |

## 7.5 Judge Experience

- **First-visit state:** landing hero with the product statement and the 0.63% figure; a live card for Launch C (open, relaxed demo timing) with countdown and margin; Launch A (PASS) and Launch B (FAIL) cards with "opened earlier" tx hashes; an honesty strip with status, limits and caps; a button to `/demo`.
- **Seed script requirements:** `scripts/seed-demo` creates Launches A, B and C, the devnet mint for A, and the recorded-receipt index (table in section 6). Idempotent.
- **10-second test:** the hero says what it does in one sentence and shows the verdict panel of a real launch.
- **30-second test:** a visitor sees Launch A's verdict inputs, the margin, and the genesis mint with null authorities, and can click "check it yourself" to see the `verify.sh` output.
- **60-second test:** the primary action is "Try the dry run": a no-wallet quote for a Solana entry and a rule-code preview of a hostile preset. A visitor with a testnet wallet can walk from Launch C.
- **Landing page content:** no empty states and no login walls. Wallet connect appears only at the moment of an action.
- **Demo-insurance invariant check:** the product's claim is verifiability, so fabricated state is forbidden outright (TASTE U7). Allowed: state the product genuinely produced in advance (the seeded testnet launches, the devnet mint, the mainnet T-series receipts), each labelled "opened earlier" with tx hashes. Forbidden: a success animation without a call, a cached verdict, a stored-success response, or a made-up count.
- **Keys-off-host demo path (custody product: yes, `custodyProduct: true`):** Kruxa holds a genesis key (one session), a relayer function-call key, an attestation key and a reserve vault, so this section is required. The cold judge path on the deployed URL needs no local keys: read-only pages, `preview_charter` views, dry quotes, `verify.sh` against settled devnet launches, recorded evidence. The web host holds no funds and no signing keys. The genesis key lives in the ceremony host's memory (demo) or in KMS (beta), never on the web host. Recorded in state as `keysOffHostDemoPath`: "read-only app plus verify.sh plus recorded evidence plus seeded testnet/devnet launches".

## 7.6 Judge Proof Artifacts

- **Proof route:** `/proof` and a README section "Our Integration", mirrored in `submission/proof.md`. [SYNC 2026-11-10: no `/proof` route (ruled out); the README section and the recorded evidence remain]
- **Required artifacts:**
  - NEAR testnet addresses of `core` and `demo`, with the wasm sha256 matching `view_code`.
  - Devnet mint addresses for Launch A with null authorities, and the absent address for Launch B.
  - Chain Signatures results table from `warroom/signed-tests/state/test2.json`: T0 derivation match, T1p/T1b Solana mainnet transfer signed by the MPC-derived key (T1b signature `2AJfSjNKfCrdw6fN7DM1XKDrrCsbbgu4hz9ULBUWNna9QrbarLnMTxBiyEFkKr5adXon4qiWUfsEUVvrHqmKuwWd`, funding T1a `2VMcLc3Ff7KMd23dBcawyQW7xy4pTzDPjqfD3TfogeUVTMKZRUKnNEtBVDvG2fSuM2BVaa5eL7qa3N2AZ3bSU9iR`), T2 20 of 20 with latencies, T3 1,150-byte payload, T4 devnet mint `rktRrftPETTotHEf3jLTPSJQ1bPv6oFoBQFGEQzhEHz` with all six checks true, T5 NEAR mainnet txs `3HVLFJ5ussoJktiqeLyEGvxNTsobUogHhP7T7rASfv4f` (deploy, code hash `2VGQJw5MG5yQ7ZN7HfFKRvY7nFcUvJNAgSofb56Es8oC`), `E9w896pZfi4oJimEhctMMq32HhuK3Q8Anpnu3CTbruGd`, `9GCxnLUubUrpJqvDrfyhLc3hga45rZSreJ46jzcmGDZn` and the refusal of a mismatched message.
  - Integration counts: Intents calls (dry quotes, simulate runs, sandbox S3 runs), Solana simulations, verification results.
  - `verify.sh` outputs for Launch A (exit 0) and `--tamper-all` (exit 2).
  - The honest status table: PROVEN, SOURCE-READ, UNPROVEN (OV4, OV15, factory cost), with dates.
- **Proof generation:** the build phase runs the seed script and `verify.sh`, captures outputs to `submission/proof.md`, and stores evidence JSON with sha256.
- **Explorer links:** NEAR mainnet `https://nearblocks.io/txns/{tx_hash}` and `https://nearblocks.io/address/{account}` [ASSUMED explorer choice]; NEAR testnet `https://testnet.nearblocks.io/txns/{tx_hash}` [ASSUMED]; Solana `https://explorer.solana.com/tx/{signature}?cluster=devnet` and `https://explorer.solana.com/address/{address}?cluster=devnet`; mainnet drops the cluster parameter.

---

## 8. Day-by-Day Build Plan

Dami ruled no scope cut: everything stays on the roadmap and is sequenced into waves. **Capacity rule [RULED R-CAPACITY, 2026-11-08: "I'm working with you, so it should be achievable"]:** the time budget counts Dami's own human-gated tasks, listed with dates in CHANGE-ORDER-4 section 15 (as amended by CO-5) and in the P-rows below; agent-days alone are not the budget. This section gives (8.1) the staged roadmap with hard gates, (8.2) the prerequisites that must clear before dependent stages, (8.3) the day-by-day plan for the 8 days from today to the deadline, and (8.4) the cut order if a gate goes red. The risk map is section 7 (each risk names its binding stage in the DT list).

Re-timed by CHANGE-ORDER-3 on Sunday 2026-11-08. Wave numbers follow PRODUCT-VISION-V2 section 5; the new sub-waves 2S (Meteora spike), 2M (Market-lite) and 2I (indexer) run in parallel with the core (workstreams in PLAN.md). Mapping to the module list: "core contract and trial lifecycle" is Wave 1; "Solana side" is Wave 2; "app, onboarding, extra surfaces" is Wave 3; "fee router, market" is now Wave 2M (Market-lite) with Hold Vault and referral in Wave 6b; "packaging" is Wave 4.

### 8.1 Staged roadmap (re-timed by CHANGE-ORDER-3)

| Stage | Dates | Envelope | Hard gate |
|---|---|---|---|
| Wave 0 De-risk | Nov 6-8 | W0 Intents verification (source-read); signed Test 2 (T0-T5 PASS); Test 1 prepared, NOT run; testnet factory probe; sandbox S3 on the real wasm; toolchain | none |
| Wave 1 Core | Nov 7-9 | Wave 1 code plus Wave 1 deltas D-1 (creator gate) and D-3 (`open_market` handoff), see CHANGE-ORDER-3 section 13 | **G1: Nov 8 EOD** stream-lite, settle, refund green or STOP and re-plan |
| Wave 2 Solana side | Nov 9-10 | F0 primary and F1 fallback genesis on devnet, Jito distributor, Squads 48 h vault on devnet, `verify.sh` C1-C34, core `open_market` handoff | merged into G3 |
| Wave 2S Meteora spike | Nov 8-10 | devnet DAMM v2 locked-LP pool plus four DBC checks, pass/fail table in `spikes/meteora/RESULT.md` | result recorded before G3 |
| Wave 2M Market-lite | Nov 8-11 | `market.kruxa.near` M-A scope, testnet end to end, adversarial suite | **M-gate: Nov 11 EOD** |
| Wave 2I Indexer | Nov 8-11 | event ingest, candles, trades, launch feed API, hosting tier 2 | part of M-gate |
| **G3 Genesis Round go/no-go** | **Nov 10 EOD** (moved from Nov 11) | the rows of section 9.3, hard rows cannot be waived | real check, never skipped |
| Genesis Round on mainnet | open Nov 11 (target 12:00, latest 18:00 UTC); settle and genesis Nov 12 | each step DAMI CONFIRMS | per-action confirmations |
| Wave 3 Surfaces | Nov 9-12 | landing, Studio with payout recipient, launch feed, token page with charts, trades, creator desk, portfolio, verify, `/proof` [SYNC 2026-11-10: no `/proof` page, ruled out], wallet chooser, tier A and B track modules | **G4: Nov 12 EOD** feature freeze, fresh-agent README run, track claims checked |
| Capped beta | Nov 12 evening to Nov 13, only after genesis success and the B-gate | owner opens the creator gate; same caps | **B-gate: Nov 12 EOD** (BLK-1 closed, C12 passes, disclosures live) |
| Wave 4 Submission | Nov 13-14 | repo public, X post, one-shot submit | **G5: Nov 13** preflight |
| Wave 5 (after) | no dates | Earned Terms live, Survivor Pass at scale, Observatory, Calibration Scoreboard, Telegram bot | capped beta needs independent review first |
| Wave 6b (after) | no dates | Hold Vault, referral lots, ratchets, payee splits, Solana-side fees, DBC (if four checks pass), best-venue routing | needs review |
| Wave 7, 8 (after) | no dates | as before (bridge, ReserveGate, F0 Rail signer; per-token DAO, sealed rounds, covenants) | audit |
| Launch ladder | after the hackathon | the Genesis Round and the capped beta are the labelled tiny-amount rung; 10x caps only after independent review (timelocked) | review before real user funds beyond the caps |

Spike plan: Phase 0B stays skipped; the Meteora spike (S-M, pass/fail in PLAN) is the new spike.

### 8.2 Prerequisites (carried, dated, each assigned to a gated item)

| ID | Prerequisite | Needed by | Gates | Owner | Status |
|---|---|---|---|---|---|
| P-01 | Rust 1.95.0 and `cargo-near` 0.23.0 installed (machine had rustc 1.91.1 on 2026-11-06) | Nov 7 | G1 | Claude | [UNVERIFIED: current state] |
| P-02 | Testnet factory call: cost, refund of excess, `ft_burn` present (OV9) | Nov 8 | G1, R-05, R-33 | Claude | not done |
| P-03 | Sandbox run of S3 against the real `intents.near` wasm, with refund-on-reject | Nov 9 | DT-2 | Claude | not done |
| P-04 | Signed Test 1 (OV4 credit, OV15 `ft_withdraw`, S3 micro-test, Phantom byte-exactness). Test 1 is funded from the funds Dami already sent (held in the throwaway wallets); Dami sends NO more money [RULED R-50]. Claude writes dry-run-by-default scripts (`fund-t1.ts`, `test1.ts`, `get-usdc-t1.ts` in `warroom/signed-tests`) and verifies results read-only; **Dami runs every money-moving command himself with the `!` prefix** [RULED R-49/R-51]; Claude never converts, swaps or bridges funds (harness rule). State 2026-11-08: T1 SOL 0.005, T1 NEAR 0.02 funded; `register` aborted before broadcast because the network needs about 0.0322 NEAR in balance, so the T1 NEAR target is 0.15 NEAR from held funds; USDC comes from `get-usdc-t1.ts` (a swap from Test 1's own SOL, dry-run quote about 0.0015 SOL for about 0.1285 USDC) | Nov 10 | defi claim, G-3 | Dami runs, Claude verifies | funded in part; register, USDC swap and `all` NOT run |
| P-05 | 1Click partner JWT (lowers fee from 0.25% to 0.20%) | Nov 9 | cost only | Dami | [UNVERIFIED: how to obtain] |
| P-06 | Relay-fee policy ruling (section 9.4) | Nov 8 | G1 RuleSet constant | Dami | OPEN |
| P-07 | Storage payer confirmation (creator bond versus wording of #25) | Nov 8 | G1 | Dami | OPEN |
| P-08 | Launch-fee storage reserve (0.1 NEAR) versus "only genesis and attestation rent" | Nov 8 | G1 | Dami | OPEN |
| P-09 | Reserve split versus the 15-30% reserve in the vision | Nov 9 | GenesisSpec compile | Dami | OPEN |
| P-10 | F0 versus F1 genesis for v1 | Nov 9 | G2 | Dami | OPEN (found during this forge) |
| P-11 | Brand token supply, allocation, name, symbol metadata and image | Nov 9 | G2 compile, G3 | Dami | OPEN |
| P-12 | Genesis Round pool and LP-seed amounts (DN-14); venue, timelock and the 100% NEAR pool for round one RULED | Nov 10 | G3 | Dami | amounts OPEN |
| P-13 | Dami's 3 separate hardware wallets for the Squads demo vault (public keys only into the manifest). The vault is created at the Nov 10 gate (GR-7), so order today if not owned | **Nov 10** (was Nov 12) | GR-7, mainnet Genesis Round | Dami | OPEN |
| P-14 | Legal posture minimum: terms, risk disclosure, geoblocking approach | Nov 10 | G3 | Dami | [UNVERIFIED] |
| P-15 | X account live and handle fixed; domain; tier 2 hosting accounts (durable through Nov 25, minimum Nov 18) | Nov 12 | G5 | Dami | X account started 2026-11-06; rest OPEN |
| P-16 | NEAR mainnet payout account for the submission form | Nov 13 | G5 | Dami | OPEN |
| P-17 | Repo LICENSE file; disclose libraries and any pre-window code (judged code must be new since 2026-10-19: Q-001, Q-005) | Nov 12 | G5 | Claude | not done |
| P-18 | Phase 2 social intel (guided social review) | none hard | none | Dami | pending since intel |
| P-19 | Independent review of NEAR contracts and Solana pieces | before real user funds beyond the Genesis Round | launch ladder | Dami | GAP, disclosed |
| P-20 | BLK-1: two named independent Squads signers (Dami: "when we get there"; not needed for the Genesis Round) | before third-party creators open; plan latest Nov 11 EOD, verified Nov 12 | capped beta, B-gate | Dami | OPEN, BLOCKER for third-party creators only; fallback DT-8 |
| P-21 | Meteora devnet spike result (S-M) | Nov 10 midday | G3, DT-7 | Claude | not started |
| P-22 | Core wasm freeze with D-1 and D-3 | Nov 10 EOD | G3, Nov 11 deploy | Claude | not started |
| P-23 | Hosting accounts and domain (tier 2 RULED, DN-16) | Nov 10 | tier 2 hosting | Dami | tier RULED; accounts OPEN |
| P-24 | Market reserve caps (DN-17, $5,000 per pool and $15,000 global, interim) and fee split (DN-15, 50/15/15/10/10) | Nov 10 | M-gate, Market-lite constants | Dami | RULED (caps interim; Dami may confirm final) |
| P-25 | Pool and LP-seed amounts (DN-14); the split is RULED 100% NEAR pool for round one | Nov 10 | G3 | Dami | amounts OPEN |
| P-26 | near-connect pin and publisher check (look-alike package names exist) | Nov 9 | wallet layer | Claude | not done |
| P-27 | NEAR AI Cloud account, API key with credits ($10 claim or purchase; DAMI RUNS any purchase); key into a local env file outside the repo, never pasted in chat (agents, swarms) | Nov 9 12:00 UTC | agents and swarms live runs | Dami | OPEN |
| P-28 | GCP project ID with BigQuery enabled and a service-account key file path (or `gcloud auth application-default login`; gcloud is not installed here); DAMI CONFIRMS any billing prompt; never pasted in chat | Nov 9 18:00 UTC (target; CO-4 section 15) | thesis track; dropped at Nov 10 12:00 UTC if the freshness check fails | Dami | OPEN |
| P-29 | Intents partner JWT (partners.near-intents.org sign-in) into the local env file; never pasted in chat; lowers the 1Click fee from 0.25% to 0.20% | Nov 9 18:00 UTC (target) | thesis, authenticated defi quotes | Dami | OPEN |
| P-30 | Hardware-wallet public keys, hosting and domain accounts, X handle, USDC payout address (DN-9) recorded as placeholders in `.input-manifest.json` | Nov 10 | manifest | Dami | OPEN |

### 8.3 Day-by-day (CO-3 re-timed; per-agent allocation and workstream ownership are in PLAN.md)

| Day | Date | Primary objective | Secondary objective | Deliverable |
|:---:|------|------------------|--------------------|-------------|
| 1 | Sun Nov 8 | Phase 0 and 1: toolchain, extract, close Wave 1 gaps; start Market-lite interface and AMM math, Meteora spike prep, indexer schema | rulings DN-1 to DN-5 | **G1 (EOD)** stream-lite, settle, refund green |
| 2 | Mon Nov 9 | Testnet deploy, factory probe, real-wasm S3; genesis compilers and F0/F1 on devnet; Market-lite contract; Meteora spike runs; wallet layer | DN-7 brand supply and allocation | Wave 1 live on testnet |
| 3 | Tue Nov 10 | Core wasm freeze with D-1 and D-3; Squads 48 h vault rehearsed on devnet; F0 three clean rehearsals or F1 chosen; spike result by midday; Test 1 run by Dami with the `!` prefix, no new money (P-04) | gate script | **G3 (EOD) Genesis Round go/no-go** |
| 4 | Wed Nov 11 | On GO: deploy core (Dami), register USDC, open the $KRUXA trial by 12:00 UTC (latest 18:00). Market-lite testnet e2e, token page and charts, tier B modules | creator desk, payout UI | **M-gate (EOD)** market and indexer green or the market stays testnet |
| 5 | Thu Nov 12 | **Feature freeze at EOD.** Trial settles about 13:00 to 19:00 UTC; genesis; `verify.sh` on mainnet; on M-gate green deploy market and `open_market` (Dami confirms); README, track claims check, fresh-agent run | beta opening | **G4 (EOD)** and **B-gate (EOD)** |
| 6 | Fri Nov 13 | Repo public (Dami), X post (Dami), capped beta opens if the B-gate is green, preflight | payload prepared | **G5** preflight green |
| 7 | Sat Nov 14 | Submit by about 12:00 UTC (Dami); LP-seed release executes about 16:00 to 22:00 UTC; monitor | buffer | Submission receipt |

### Buffer allocation and date math
All times UTC. Production bounds: commit window at least 24 h, tail at least 1 h, Squads timelock 48 h (kept, R-GR-TIME).

| Quantity | Target case (open Nov 11 12:00) | Latest case (open Nov 11 18:00) |
|---|---|---|
| commit_end (open + 24 h) | Nov 12 12:00 | Nov 12 18:00 |
| walk_end and earliest settle (+1 h) | Nov 12 13:00 | Nov 12 19:00 |
| positions pages, sweep, consolidate (about +1 h) | Nov 12 14:00 | Nov 12 20:00 |
| genesis confirmed (F0 sign p50 13.5 s, p95 15.1 s per T2; ceremony plus confirmations about +1.5 h) | Nov 12 15:30 | Nov 12 21:30 |
| LP-seed release proposal created | about Nov 12 16:00 | about Nov 12 22:00 |
| release executable (+48 h) | **Nov 14 16:00** | **Nov 14 22:00** |
| margin to Nov 14 23:59 | 8 h | 2 h |

So the trial should open by Nov 11 12:00 UTC, must open by Nov 11 18:00 (2 h margin), and opening after about **Nov 11 20:00 UTC** puts the Solana LP-seed release after the deadline, which is then disclosed. The NEAR pool does not wait: its LP is permanent inside the contract, so `open_market` can run right after settle once the market is deployed. [ASSUMED] the stage durations after settle; the T2 latencies are from the signed test.

What lands after Nov 14 whatever happens: any third-party trial opened Nov 13 or later (at least 25 h to settle); Solana-side DAMM v2 pool for $KRUXA unless opened by about Nov 11 18:00; creator allocation cliff (14 days or more), backer-bonus 30-day vest, 90-day fee vest; Hold Vault, referral payouts, ratchets, payout-change flow, per-chain payouts; DBC if the four checks pass; independent review; cap raise (7-day timelock).

Other buffers: Nov 14 submit by about 12:00 UTC leaves about 12 h. Nov 12 and 13 are for the freeze, README, recording and the Genesis Round, not new features.

### 8.4 Cut order if a gate goes red (CO-3)
Cut first to last (CO-4 detail: business and nfts are never started, thesis is cut at the Nov 10 12:00 UTC drop rule or after the swarm and agent extras, CHANGE-ORDER-4 section 14): (1) tier C track modules (business, nfts) and the CO-4 extras in that section's order; (2) swarms; (3) agents module (keep read-only MCP); (4) defi extras beyond the dry quote; (5) hosting tier 2 falls back to tier 1 (only with Dami's OK, because tier 2 is RULED); (6) Solana wallet chooser polish (keep Phantom `signMessage` for `walk_signed`); (7) near-connect falls back to the already built wallet-selector; (8) token-page chart (keep the trades table); (9) creator CSV export; (10) Meteora venue builder (keep the spike result document); (11) Verdict Rail attestation; (12) Studio polish, MCP server, agent API; (13) `audit_page`, `claim_orphan_credit`, `claim_refund_batch`, Route B, S4 fallback (only if S3 is green); (14) Market-lite on mainnet (keep it on testnet; the LP seed stays in core and is disclosed); (15) the capped beta opening; (16) Solana mainnet genesis (keep devnet plus hash commitment); (17) the Genesis Round. Never cut: Walk, deterministic verdict, `settle`, pull refunds, stream-lite and `STREAM_CAP`, null authorities, `verify.sh` with tamper, the no-funds README path, the disclosures, and the per-action confirmation rule. Honest budget (PLAN.md): demand 15.35 agent-days against 15.2 usable, so the first cuts are expected to fire.

---

## 9. Dependencies & Prerequisites

### 9.1 External services
The thirteen external APIs are specified in section 5 (A1 to A13). Hosting for the web app and the indexer: tier 2 [RULED DN-16, 2026-11-08], durable (no spin-to-zero), kept up through Nov 25 (minimum Nov 18, the judging window; Q-012). The provider is not chosen and the accounts are Dami's task (P-23) [OPEN]. Added by CO-3: A14 Meteora, A15 neardata.

### 9.2 Dev tools, accounts, addresses
| Item | Pin or value | Source |
|---|---|---|
| Rust toolchain | 1.95.0 with `wasm32-unknown-unknown` | S1-A 2.1 |
| near-sdk, near-contract-standards | `=5.30.1`; `universal-accounts` feature OFF | S1-A |
| cargo-near | 0.23.0 | S1-A |
| near-workspaces (tests only) | `=0.24.0`; sandbox 0.4.0 runs protocol 88 and mainnet reports protocol 88 too [VERIFIED 2026-11-08]; wasm acceptance on the real network is still proven only by the testnet deploy | S1-A 1.3 |
| Mainnet runtime | nearcore 2.14.0, protocol 88 [VERIFIED 2026-11-08, curl `status` on rpc.mainnet.near.org: version 2.14.0, protocol_version 88], storage 1e19 yocto per byte | CO-3 (supersedes S1-A 1.3) |
| Signed-test kit | near-api-js 7.4.0, `@solana/web3.js` 1.98.4 (not 3.x) | signed-tests README |
| Docker | present (28.5.1) for reproducible builds; image tag `sourcescan/cargo-near:0.23.0-rust-1.95.0` is [UNVERIFIED] | S1-A |
| Accounts to create | `core`, `demo`, `treasury`, `guardian`, `genesis-relayer`, `keeper`, `relay-fees` under the project root (`kruxa.near` confirmed free on 2026-11-06 [VERIFIED: DECISIONS-PACK1]) | RECONCILED 2.1 |
| Throwaway keys | Claude generates; kept in the scratchpad or env vars; never in the repo; never Dami's real wallets | ruling #4 |

### 9.3 Genesis Round go/no-go gates (G3, Nov 10 EOD; Dami edits the list)
**The three gate names (defined once, here).** They are intentionally different gates; every other mention in the forge docs points to this table.
| Gate | Date | Decides | Tracks in the plan |
|---|---|---|---|
| Genesis Round gate (G3) | **Nov 10 EOD** (moved from Nov 11 by R-GATE-MOVE) | whether the $KRUXA Genesis Round opens on mainnet; the core wasm freezes at the same time; rows GR-1 to GR-17 below | real check, never skipped |
| M-gate (Market-lite) | **Nov 11 EOD** | whether `market.kruxa.near` goes to mainnet (GR-16 is its formal row) or stays testnet (DT-9) | PLAN Part CO-3 |
| B-gate (capped beta) | **Nov 12 EOD** | whether the creator gate opens to third-party creators: genesis succeeded, BLK-1 closed, C12 passes, disclosures live | PLAN Part CO-3 |

The ruling fixes the date (Nov 10 EOD since R-GATE-MOVE), the cap and the disclosure of the review gap. The check is real and is never skipped. HARD rows cannot be waived; a red WAIVABLE row can be waived by Dami only with the stated consequence. `scripts/gate-g3.sh` prints one line per row and GO only if every HARD row and every non-waived row is green.
| Gate | Type | Condition | Evidence |
|---|---|---|---|
| GR-1 | HARD | Wave 1 green on testnet including the adversarial suite, with D-1 and D-3 merged and the full Wave 1 suite re-run | `make test-unit`, sandbox suite, invariants view |
| GR-2 | HARD | Devnet end to end for PASS and FAIL; `verify.sh` exit 0; `--tamper-all` exit 2 | recorded outputs |
| GR-3 | WAIVABLE | Intents path decided: signed Test 1 recorded, or Solana-landing claims dropped | `state/test1.json` or README edit |
| GR-4 | HARD | Real factory cost and `ft_burn` known on testnet; mainnet cost bounded by the deposit formula | P-02 result |
| GR-5 | HARD | Caps in code: $1,000 per launch, $3,000 global, raise timelocked | `R_CAP_LAUNCH`, `R_CAP_GLOBAL` tests |
| GR-6 | HARD | Pause, freeze and guardian tested; exits open while PAUSED | tests |
| GR-7 | HARD | Squads vault rehearsed on devnet with the 48 h lock configuration; Dami's 3 hardware wallets ready | P-13 |
| GR-8 | HARD | Disclosure pages published: no audit, single-party reserve, publisher-updatable factory token, Intents force powers, relay fee, NEAR token exists before the verdict, Market-lite unreviewed | `/charter` |
| GR-9 | HARD | Legal minimum (terms, risk disclosure) | P-14 |
| GR-10 | HARD | Timeline check passed: open by Nov 11 18:00 UTC at the latest (section 8.3) | date math |
| GR-11 | HARD | Dami confirms each mainnet step individually | per-action log |
| GR-12 | HARD | F0 clean in three rehearsals on testnet plus devnet, else F1 chosen and disclosed | `rehearse.sh R5` [SYNC 2026-11-10: `scripts/rehearse.sh` defines only R1 and R2. The F0 rehearsals ran through `relayer/src/genesis-cli.ts` and `scripts/genesis-devnet.sh`: 6 rehearsals through the contract gate on core3 (launches 2, 5, 6, 8, 9, 10; launch 10 on the deployed reproducible wasm); `evidence/genesis/core3-f0-devnet-launch*.json`, `rehearsal/ROUND2.md`, `ROUND3.md`, `ROUND4.md`. PLAN Depth 8 drills R3 to R10 were never scripted and are superseded by the hand-written rows of `rehearsal/LOG.md`] |
| GR-13 | WAIVABLE | Meteora spike result recorded with pass/fail per check; a FAIL means NEAR pool only for round one (DT-7) | `spikes/meteora/RESULT.md` |
| GR-14 | HARD | Core wasm hash recorded with D-1 creator gate closed to everyone but the owner (no other token can exist on mainnet) | wasm sha256, `R_CREATOR_GATE` test |
| GR-15 | HARD | `open_market` handoff proven against the market stub or market testnet build | sandbox test |
| GR-16 | WAIVABLE | Market-lite testnet e2e (otherwise the market stays testnet, DT-9; this row is formally the M-gate, see the table above) | `make market-demo` |
| GR-17 | HARD | Brand-token supply and allocation ruled (DN-7), USDC payout address known (DN-9), pool and LP-seed amounts ruled (DN-14) | rulings |

### 9.4 Open items register (do not invent answers; owner Dami unless stated)
| # | Open item | State |
|---|---|---|
| O-1 | Reserve split versus the 15-30% reserve in the vision | field `reserve_bps` exists, default 0, no room in the 60/25/10/5 buckets; if wanted it comes out of the sale bucket and defaults are restated |
| O-2 | Storage payer | RECONCILED row 26 says the creator bond pays all position storage; DECISIONS-PACK1 #25 wording says holders pre-register and the platform sponsors Solana-origin holders, which contradicts the rulings on buyers' costs |
| O-3 | Launch-fee storage reserve (0.1 NEAR per launch) versus the ruling that the platform pays only genesis and attestation rent | recommended: keep the reserve from the launch fee (about $0.40 against a $10 minimum fee) |
| O-4 | Relay-fee policy | RECONCILED: at most $0.50 and at most 5% of the amount, non-refundable, paid to `relay-fees.kruxa.near`. DECISIONS-PACK1 suggests at most 1% of the commit, non-refundable. These differ |
| O-5 | Squads independents (BLK-1, DN-21) | two named people; Dami: "id name 2 friends when we get there" [RULED wording, R-47]; not needed for the demo or the Genesis Round; BLOCKER for third-party creators; owner Dami; plan latest Nov 11 EOD [ASSUMED]; fallback DT-8 |
| O-6 | Brand token supply and allocation | not decided; the Genesis Round charter needs it by Nov 9-11 |
| O-7 | F0 versus F1 for genesis | RULED 2026-11-08 (R-F0F1): F0 primary, F1 fallback; closed |
| O-8 | Genesis Round pool venue, LP seed route, Squads time lock | venue RULED (NEAR own pool, Solana Meteora, R-METEORA); timelock RULED kept (R-GR-TIME); amounts and the NEAR/Solana split are DN-14, still open |
| O-9 | Real cost of `create_token` on mainnet and refund of excess | unproven; first observed at the brand launch |
| O-10 | OV4 Intents credit and OV15 `ft_withdraw` to Solana | unproven live; Test 1 prepared, not run |
| O-11 | README headline wording | DEFERRED by Dami (#17); placeholder in section 1.1 |
| O-12 | Preferred track on the submission form | Dami at submission; recommendation in section 1.5 |
| O-13 | Fee split (DN-15) | RULED 50/15/15/10/10 (R-46); closed. See section 4b.3 |
| O-14 | Pool and LP-seed amounts, NEAR versus Solana split (DN-14) | split RULED in part: 100% of the LP seed on Kruxa's NEAR pool for round one, the 48 h timelock does not gate it; amounts and any later Solana share OPEN |
| O-15 | Hosting durability tier (DN-16) | RULED tier 2, durable, through Nov 25 (minimum Nov 18); closed. Accounts are P-23 |
| O-16 | Market reserve caps (DN-17) | adopted as interim by "go with your recommendation": $5,000 per pool, $15,000 global, separate from the raise caps; Dami may confirm final by Nov 10 |
| O-17 | Brand token supply and allocation (DN-7), USDC payout address (DN-9), README headline (DN-12), relay-fee ceiling (DN-1), oversubscription ceiling (DN-2), reserve split (DN-3), storage payer (DN-4) | unchanged, still open |
| O-18 | Beta access and caps (DN-18, DN-19) | RULED: open to any NEAR account under the $1,000 and $3,000 caps, only after BLK-1 is settled; closed |
| O-19 | "Arcos" (DN-25) | not found; nearest real name is Arcus, a Robinhood Chain tokenized-stock exchange, not a launchpad [NOT FOUND]. Dami to supply a link or screenshot; default dropped; no deadline |
| O-20 | Thesis credentials (DN-24b: GCP project and key file, Intents partner JWT) and NEAR AI Cloud key | target Nov 9 12:00 and 18:00 UTC; thesis dropped at Nov 10 12:00 UTC if not usable (P-27 to P-29) |
| O-21 | RECOMMENDED, NOT YET RULED by Dami (CHANGE-ORDER-4 section 16): DN-26 opening-fee start 500 bps over 60 min with surcharge to LP; DN-27 build the agent vault; DN-28 defer the Meteora venue builder (0.6); DN-29 promote thesis (conditional); DN-30 business stays tier C; DN-31 model `Qwen/Qwen3.8-27B`; DN-32 six concurrent agents at a 0.7 factor | pending Dami; the plan proceeds on the recommendation only where PLAN Part CO-4 says so, and every one is reversible until its date (Nov 9 to 10) |

### 9.5 Conflicts found between specs and rulings
| # | Conflict | Where | Handling in this PRD |
|---|---|---|---|
| X-1 | The WINNER-BRIEF demo obligation puts trials and tx hashes on mainnet; the mainnet policy forbids any other token or mint before the brand token | WINNER-BRIEF DEMO OBLIGATION versus DECISIONS-PACK1 mainnet policy | Demo runs on testnet/devnet with recorded mainnet plumbing receipts; the brand launch is the only mainnet token [SYNC 2026-11-11: no mainnet deploy exists. AMEND-2 was not approved (DECISIONS-PACK1 tenth block), so the obligation text still says mainnet; the judged demo is NEAR testnet and Solana devnet plus the no-funds path, and mainnet appears only after Dami's per-action confirmation] |
| X-2 | Walk destination. Thesis invariant says buyers are refunded "to the origin chain minus the withdrawal fee"; S1-B 6.3 says the refund lands in the buyer's own Intents account with no fee, and the Intents fee applies only if the buyer withdraws to a Solana wallet (which is OV15, unproven) | WINNER-BRIEF Thesis versus S1-B 6.3 | Canonical wording follows S1-B 6.3 (INVARIANTS N2). "Origin chain" is not claimed |
| X-3 | Relay-fee ceiling: $0.50 and 5% versus at most 1% | RECONCILED 8-16 versus DECISIONS-PACK1 open line | OPEN (O-4) |
| X-4 | Factory cost and name: about 0.05 NEAR at `token.primitives.near` versus about 2.36 NEAR at `tkn.primitives.near` | WINNER-BRIEF, S1-A versus PULSE | OPEN (R-05, O-9) |
| X-5 | Genesis platform cost: 0.0193 SOL versus 0.0263 SOL | DECISIONS-PACK1 versus S1-D 11 | Budget with 0.0263 (RECONCILED R3) |
| X-6 | Commit window upper bound: 14 days versus 30 days | S1-B 2.4 versus DECISIONS #27 and RECONCILED | 30 days |
| X-7 | Token route for real-money launches: own FT by hash versus factory token for all launches | S1-A, DECISIONS #6, RECONCILED Track G versus the 2026-11-07 ruling | The ruling wins: factory token; disclosed |
| X-8 | RECONCILED section 7 marks the Genesis Round "NOT yet accepted" | RECONCILED R8 versus the 2026-11-07 ruling | The ruling wins: accepted, gated |
| X-9 | Rule code spellings inside RECONCILED: `RMinBuy` and `RMinContribution`; `RWalletCap` and `RCapAccount`; S1-C spells the pre-PASS draw refusal `NOT_PASS`, which has no row in the canonical table | RECONCILED 5.1 and S1-C 4.1 | INVARIANTS uses `R_MIN_CONTRIBUTION`, `R_CAP_ACCOUNT`, `R_WRONG_PHASE` and lists aliases; the build picks one at first compile [ASSUMED] |
| X-10 | README one-liner "The creator takes at most 1.00% of volume" (PRODUCT-VISION-V2 section 4) versus the S1-C finding that creator-controlled wallets can capture up to 80% of the fee | PRODUCT-VISION-V2 versus S1-C 9.1 and decision 12 | Unqualified sentence forbidden (INVARIANTS MUST NOT CLAIM); headline deferred |
| X-11 | WINNER-BRIEF v0 distribution (relayer-held DISTRIBUTION account, at most 7 holders) versus S1-D claim-based Jito distributor | WINNER-BRIEF versus S1-D, RECONCILED | S1-D wins (RECONCILED) |
| X-12 | WINNER-BRIEF says Chain Signatures is not used and F0 is a Nov 10 upside; T0-T5 have since passed | WINNER-BRIEF versus PULSE and the signed tests | Claims limited to what T0-T5 proved |
| X-13 | The NEAR-side token exists from `create_trial` (token created at trial start, ruling #23), while the brief says the token exists only after PASS | WINNER-BRIEF headline versus DECISIONS #23 | Claim is scoped to the Solana mint; INVARIANTS MUST NOT CLAIM |
| X-14 | The request names a "scaffold gate Nov 8 EOD"; WINNER-BRIEF and RECONCILED name a Nov 8 EOD stream-lite gate | request versus specs | Treated as the same gate G1 [ASSUMED] |
| X-15 | PRD 1.4, C5 and Flow 10 said the fee layer and market are Wave 6 and the Genesis Round trades on an external pool | PRD V1 versus R-METEORA | Superseded: Market-lite is pre-freeze; the Genesis Round uses the NEAR pool and later a Meteora pool |
| X-16 | Mainnet "protocol 87" in PRD 9.2 and C1, ARCHITECTURE, INVARIANTS, SUBMISSION_STATUS | those docs versus the live RPC | Mainnet reports protocol 88 [VERIFIED 2026-11-08]; corrected everywhere |
| X-17 | Break-even $16M at $80K cost (research file) | research versus arithmetic | Corrected to $40M at 0.20%; $16M only at 0.50% (section 4b.5) |
| X-18 | Go/no-go on Nov 11 EOD | PRD V1 versus R-GATE-MOVE | Nov 10 EOD |
| X-19 | "No token on mainnet before $KRUXA" was process-enforced only | INVARIANTS 6 versus a permissionless `create_trial` | Contract-level `R_CREATOR_GATE` (D-1) |

---

## 10. Concerns Compliance

Source: `warroom/concerns-snapshot-V1.md` (universal concerns from `~/hackathon-toolkit/concerns.md` v2.0, plus per-hackathon PH1 to PH13 and the corrections of 2026-11-05 and 2026-11-06). [C] means eliminated if violated, [I] costs points, [A] is advisory.

### [C] Critical concerns
| # | Severity | Concern | How the PRD addresses it |
|---|---|---|---|
| 1 | [C] | Time is not a constraint for merit evaluation | The PRD scopes the whole platform at roadmap level (section 8) and does not cut for build time; the slice is a subset, not the yardstick (lesson 2026-11-06). Gates state what a judge can run by Nov 12 as a scoping statement only |
| 3 | [C] | Uniqueness; competitors are a serious strike | Section 1.2 names meme.cooking, Tripwire and Calyx; section 1.3 claims only an unoccupied application of known mechanisms; R-19 and R-20; "first" and "novel" are forbidden in INVARIANTS |
| 5 | [C] | Does this help real humans | Section 1.2 problem statement and the Walk right; the problem is loss from rugs; the product reduces harm (verdict, refund, caps) rather than adding a token factory |
| 8 | [C] | Cumulative corrections, nothing dropped between versions | Every ruling of 2026-11-06 and 2026-11-07 is applied (section 1.5, section 4 C1 parameters, section 9.4); lessons of 2026-11-06 are carried (who pays each cost, no uniqueness without search, wrong yardstick) |
| 9 | [C] | Must solve a significant real problem the builder believes in | Dami confirmed C9 (PRODUCT-VISION-V2 section 0: "i would build without a prize but i definitely have to win"); Kruxa is his own product and the Genesis Round launches his own token |
| 13 | [C] | Must serve users who exist today; name who uses it on day 1 | Partly met, stated honestly: day-1 users are Dami as creator for $KRUXA, judges as verifiers, and whoever Dami's X audience brings to the Genesis Round. The size of that audience is not known [UNVERIFIED]; builder-seeded trials are labelled. Not claimed beyond this |
| 15 | [C] | No self-duplication of shipped or in-flight projects | No launchpad or token-issuance project exists in the built-projects record (concerns snapshot); banned shapes (agent registry, private yield vault, SolvencySwap, x9 Solana agent wallet, commit-resolve-attest reputation) are avoided; the Verdict Rail is a read-only attestation of a launch verdict, not a reputation product of that shape [ASSUMED, to confirm at critique] |
| PH1 | [C] | Direction lock: production-grade launchpad on NEAR, tokens also on Solana, anchored on launch lifecycle | Whole design is anchored on launch, trial, genesis and distribution; modules beyond the launchpad are launch-anchored (record, rail, market) |
| PH2 | [C] | Mainnet ruling with a no-funds dry-run path; per-action confirmation | Section 6 and 7.5: no-funds path for every step; mainnet limited to plumbing and the brand launch; hard constraints at the top of this PRD; the mainnet policy also requires testnet/devnet rehearsals |
| PH4 | [C] | Differentiation by mechanism, not a plain bonding curve | Mechanism: Walk, deterministic verdict, verdict-gated second-chain existence, capped stream; no bonding curve in the slice |
| PH6 | [C] | Safety and legal awareness; how the product avoids being a rug machine | Caps, Walk, pull refunds, null authorities, capped draw, `STREAM_CAP`; risk R-27 and R-30; disclosure pages; legal posture marked [UNVERIFIED] and listed as a prerequisite P-14 |
| PH7 | [C] | Extensive, production-path product, not a single demo path | Sections 2 and 8: sixteen components, eight waves, launch ladder, creator flow, launch engine, liquidity (Market-lite pre-freeze, Hold Vault Wave 6b), cross-chain layer, discovery (Board, API), governance handoff (Wave 8), revenue (launch fee, relay fee), roadmap from slice to production |
| PH8 | [C] | Self-serve token creation, no curation, presets with enforced safety defaults | Flow 1 and C1 detail A: any NEAR account creates a launch from presets; the contract rejects hostile configs with rule codes |
| PH10 | [C] | Creator earnings are part of the launchpad, with a contract-enforced maximum | Section 1.4 and C1 detail A: fee terms validated at create (`R_CREATOR_TAKE`), capped stream (`STREAM_CAP`) in Wave 1, fee epochs in Wave 6; honest bound stated (declared 1.00% of volume, creator-controlled wallets at most 80% of the fee) |
| PH11 | [C] | The product is more than the launchpad | Components C10 to C15 and the Wave 5 to 8 modules; the launchpad is module one |
| PH12 | [C] | No feature called unique without a prior-art search | Section 1.3: each component is called an unoccupied application of a known mechanism (dominant assurance contract, Tabarrok 1998; refundable crowdfunding; attestation registries); prior-art searches were shallow, so no uniqueness claim is made |

Critical concerns counted: 16 ([C] items 1, 3, 5, 8, 9, 13, 15 plus PH1, PH2, PH4, PH6, PH7, PH8, PH10, PH11, PH12). All 16 appear above. Item 13 is addressed only in part and says so.

### [I] Important and [A] advisory concerns
| # | Severity | Concern | How the PRD addresses it |
|---|---|---|---|
| 2 | [I] (overridden) | Everything on devnet/testnet | Overridden by Dami on 2026-11-05 (PH2). In practice the mainnet policy of 2026-11-06 pushes rehearsals back to testnet/devnet; both are recorded |
| 6 | [I] | Read all research data | Inputs read for this phase are listed in the report; the research folder was read selectively (track angles, platform build-out, chain DNA, Illia list) |
| 7 | [I] | Be extensive | Sections 2, 4 and 8 |
| 10 | [I] | Focused product, broad problem | One mechanism (verdict-gated launch), broad problem (launch loss) |
| 11 | [I] | Winning and real impact are not exclusive | Genesis Round and real-product gates sit beside the hackathon plan |
| 14 | [I] | Demo must feel like the real product | Section 7.4b: the demo path equals the real user path on a labelled demo account |
| PH3 | [I] | Multi-track optimization, honest | Section 1.6 (CO-3, CO-4): six targeted under the freeze-time rule plus thesis as a conditional seventh, nfts and business stretch default unlisted, four dropped with reasons |
| PH5 | [I] | Honest scope; state what a judge can run by Nov 12 | Section 8.3 and the README plan; per-flow no-funds paths |
| PH9 | [I] | Cite the deep research | Problem statement cites `research/launchpad-deep-research.md` figures |
| PH13 | [I] | Plain-language explanations | Sections 1.3 and 3 use plain language; terms explained at first use |
| 4, 12 | [A] | Fresh ideas, reframing allowed | Reframing stayed inside the launchpad anchor (PH1) |

### Thesis check (identity lock)
Section 1.1 restates the current Thesis (WINNER-BRIEF as amended by AMEND-1) as the framing: a verdict-gated launch where existence on the second chain is earned and every buyer can walk first, with a capped creator draw. No drift tripwire is the headline: the keyless vault, bond and slash, clauses, a trading venue, a yield product and a bare pre-sale are not the headline (INVARIANTS.md DRIFT TRIPWIRES). Exit-right claims for Solana-delivered tokens after PASS and claims of Chain Signatures control beyond what T0-T5 proved are forbidden.

