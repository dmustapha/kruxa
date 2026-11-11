# Indexer against the real testnet contracts (E1)

Read-only. Public JSON-RPC views and neardata.xyz block GETs only. Nothing signed, sent or spent, no keys, no mainnet.

Contracts: core3.kxi-root-1108.testnet, market3.kxi-root-1108.testnet (heights 276992074 to 277076027, ingested to checkpoint 277076027),
and the instant launcher demo-instant.kxi-root-0811.testnet with its market demo-market.kxi-root-0811.testnet (heights 276794202 to 276794642, 2026-11-08 flow A and flow B).

## Commands

    # 1. block heights where the recorded txs executed (RPC EXPERIMENTAL_tx_status, 381 txs, 9 unresolved, 1378 heights)
    node scripts/indexer-collect-heights.ts heights-core3.json evidence/testnet-core3/txlog.jsonl
    # 2. fold those blocks into SQLite (neardata, 429 limited so one request at a time)
    node scripts/indexer-ingest-heights.ts core3.db testnet heights-core3.json core3.kxi-root-1108.testnet market3.kxi-root-1108.testnet ""
    node scripts/indexer-ingest-heights.ts inst.db testnet heights-instant.json "" demo-market.kxi-root-0811.testnet demo-instant.kxi-root-0811.testnet
    # 3. compare folded state with get_state / get_pool / get_instant views
    node scripts/indexer-compare-views.ts core3.db testnet core3.kxi-root-1108.testnet market3.kxi-root-1108.testnet 1,2,3,4,5,6,7,8,9 compare-core3-market3.json
    node scripts/indexer-compare-views.ts inst.db testnet - demo-market.kxi-root-0811.testnet - compare-instant.json demo-instant.kxi-root-0811.testnet 1000000000,1000000001
    # 4. snapshot mode
    node services/api/src/snapshot.ts bake core3.db testnet evidence/indexer-testnet/snapshot-core3 core3.kxi-root-1108.testnet market3.kxi-root-1108.testnet
    node services/api/src/snapshot.ts serve evidence/indexer-testnet/snapshot-core3 8788

## Result

- core3 + market3: 95 checks over launches 1 to 9, 0 mismatches (compare-core3-market3.txt). Requested launches 2, 3, 6, 8, 9 all match on verdict, total_active, funders, charter_hash, rolling book_hash (also replayed from contributed and walked events), payout_recipient; launch 6 pool q, t, token, mode, opened_at, paused match market3 get_pool.
- instant: 41 checks, launches 1000000000 (Open, pool q and t) and 1000000001 (Aborted), 0 mismatches (compare-instant.txt).
- Chain-side get_invariants (all_ok) are recorded in the json files beside the matches. The indexer makes no invariant calls, so those are the contract's own claims, not a comparison.

## Caveats

- Not a full-range tail: neardata rate limits (about 2 requests a second) make a 118k height scan about 20 hours. Only blocks where recorded txs executed were fed. Events from txs not in txlog.jsonl would be missed; the match on the rolling book_hash and on pool reserves is the completeness check.
- Launches 1 and 7 never opened, so the contract holds the all zero genesis book_hash while the indexer has seen no book event (empty string). The compare treats that as a match and says so; it is the documented "null before the first book event" behaviour.
- The instant status the API serves for an Open launch with a pool is "trading"; the compare maps it.
- Real finding fixed: snapshot `/api/health` reported `uptime_s` as the current epoch seconds. It is now 0 (services/api/src/snapshot.ts, test in services/api/test/ops.test.ts).
