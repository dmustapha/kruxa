# Change Orders

Spec freeze: frozen 2026-11-08T00:00:00Z. Source of record: `kruxa/.forge-state.json` `specFreeze` (docs repo). Every change to a frozen doc needs a row here and the Doc-Sync rule in PLAN.md applies (update every doc that restates the changed fact).

| ID | Date | Change | Docs touched |
|---|---|---|---|
| CO-1 | 2026-11-08 | Ruling R-F0F1: F0 (Chain Signatures) is the primary signer, F1 is the fallback; DT-X1 rewritten | PLAN.md |
| CO-2 | 2026-11-08 | Ruling R-GR-TIME: keep the 48 h Squads timelock, Genesis Round on production bounds, LP-seed release may land after Nov 14 and is disclosed | PLAN.md |
| CO-3 | 2026-11-08 | Build additions beyond the 60-file tree: Makefile, claims ledger, gate scripts, Wave 2 and Wave 3 files | PLAN.md |
| CO-7 | 2026-11-08 | Rulings R-NETS, R-MUST-HAPPEN, R-GATE-MOVE (gate Nov 10 EOD), R-METEORA, R-PLATFORM, R-TRACKS; mainnet protocol 88 correction; multi-track table; parallel workstreams; creator gate delta D-1 | CHANGE-ORDER-3.md |
| CO-8 | 2026-11-08 | Track depth: agentkit, agent vault, attack gallery, swarm simulator, thesis (conditional); DN-26 to DN-32 recommended, not ruled | CHANGE-ORDER-4.md |
| CO-9 | 2026-11-08 | Doc-sync of deliberations: DN-15 ruled 50/15/15/10/10 with Wave 1 constant delta D-4 (`Rules.platform_bps` 2_000 to 1_500), DN-14, DN-16 to DN-19, DN-21, DN-22, Test 1 handling | CHANGE-ORDER-5.md |

## Phase 0 note (2026-11-08)

CO-1 to CO-3 are the three rows Task 0.8 names. CO-7 to CO-9 were added to the freeze record later the same day and are listed for completeness. Deltas D-1 to D-3 are not part of Phase 0; D-4 is already in ARCHITECTURE 4.3 and is therefore in the extracted code.
