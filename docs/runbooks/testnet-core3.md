# Runbook: core3 on NEAR testnet (final wasm, demo profile)

Account ids and transaction hashes only. NEAR TESTNET and Solana DEVNET, play money. Evidence: `evidence/testnet-core3/`, `evidence/genesis/core3-*`. Log: `rehearsal/LOG.md`.

| Role | Account |
|---|---|
| Core, wasm sha256 `7d7b0da22dcba27b8609c49ca96871ac029f42199948a8556603e11110d6b689` (674,863 B, non-reproducible local build) | `core3.kxi-root-1108.testnet` |
| Market (sha256 `c80560d63663fe71526f88de9ebbf5c8c16979c00ed32d1eb11b13c087ae2b26`), core = core3 | `market3.kxi-root-1108.testnet` |
| Owner / mock USDC / guardian / treasury / relay fees | `kxi-root-1108.testnet`, `usdc.`, `guardian.`, `treasury.`, `relay-fees.` under it |
| Mock Intents (reused) / mock factory (reused) | `intents.kxa1-owner-1203.testnet`, `factory.kxi-root-0811.testnet` |
| Genesis relayer | `7218da57019c05386280b3a4196e7654279e32c66e129889e17a653fc229cc85` |
| Keeper | `keeper.kxi-root-1108.testnet` |

Launches: 1 CreationFailed (test funding), 2 = A PASS F0, 3 = B FAIL, 4 = C PASS F1 + market, 5 and 6 = F0 rehearsals 2 and 3 (6 also on the market). Launch tokens are mock FTs `<symbol>.factory.kxi-root-0811.testnet`; the mock factory creates nothing, so `scripts/core-testnet/seed.mjs` creates and funds each token account (about 1.8 NEAR each).

Commands (all through `scripts/seed-demo.sh`): `A|B|C`, `settle <id>`, `genesis <id> F0|F1`, `market <id>`. Verify: `KRUXA_CONTRACT=core3.kxi-root-1108.testnet KRUXA_GENESIS_PREFIX=evidence/genesis/core3/genesis- ./scripts/verify.sh <id>`.

F0 now goes through the core: `register_f0_message`, then `sign_genesis` (the core calls `v1.signer-prod.testnet` with predecessor = the core account, path `kruxa:genesis:<id>`); `create_trial` must carry `mint_pubkey_f0` from `relayer/src/f0-key.ts --core <core> --launch <id>`.

Gas notes: a call reserves its gas at the testnet gas price (100 Tgas is about 0.1 NEAR), so test accounts need a balance above that; `consolidate` needs about 250 Tgas.
