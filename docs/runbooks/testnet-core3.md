# Runbook: core3 on NEAR testnet (final wasm, demo profile)

Account ids and transaction hashes only. NEAR TESTNET and Solana DEVNET, play money. Evidence: `evidence/testnet-core3/`, `evidence/genesis/core3-*`. Log: `rehearsal/LOG.md`.

| Role | Account |
|---|---|
| Core, wasm sha256 `665caab5a582a58b2412dfb2e81f1caf2ff94339c8bcc9f8be9ebebb72239c64` (655,387 B, reproducible container build; deployed in round 4, tx `Gu5Msp6rduKg6XZ8RFNbMeT6s2aKM2Tcvmp7GNTgWvza`, equal to `view_code` and `artifacts/SHA256SUMS`; before that the local build `e85198ed...` (675,007 B, round 3), `e338f84d...` (674,863 B, create_token gas 110 Tgas) in round 2 and `7d7b0da2...` in round 1) | `core3.kxi-root-1108.testnet` |
| Market (sha256 `c80560d63663fe71526f88de9ebbf5c8c16979c00ed32d1eb11b13c087ae2b26`), core = core3 | `market3.kxi-root-1108.testnet` |
| Owner / mock USDC / guardian / treasury / relay fees | `kxi-root-1108.testnet`, `usdc.`, `guardian.`, `treasury.`, `relay-fees.` under it |
| Mock Intents (reused) / mock factory (reused) | `intents.kxa1-owner-1203.testnet`, `factory.kxi-root-0811.testnet` |
| Genesis relayer | `7218da57019c05386280b3a4196e7654279e32c66e129889e17a653fc229cc85` |
| Keeper | `keeper.kxi-root-1108.testnet` |

Launches: 1 CreationFailed (test funding), 2 = A PASS F0, 3 = B FAIL, 4 = C PASS F1 + market, 5 and 6 = F0 rehearsals 2 and 3 (6 also on the market). Launch tokens are mock FTs `<symbol>.factory.kxi-root-0811.testnet`; the mock factory creates nothing, so `scripts/core-testnet/seed.mjs` creates and funds each token account (about 1.8 NEAR each).

Commands (all through `scripts/seed-demo.sh`): `A|B|C`, `settle <id>`, `genesis <id> F0|F1`, `market <id>`. Verify: `KRUXA_CONTRACT=core3.kxi-root-1108.testnet KRUXA_GENESIS_PREFIX=evidence/genesis/core3/genesis- ./scripts/verify.sh <id>`.

F0 now goes through the core: `register_f0_message`, then `sign_genesis` (the core calls `v1.signer-prod.testnet` with predecessor = the core account, path `kruxa:genesis:<id>`); `create_trial` must carry `mint_pubkey_f0` from `relayer/src/f0-key.ts --core <core> --launch <id>`.

Gas notes: a call reserves its gas at the testnet gas price (100 Tgas is about 0.1 NEAR), so test accounts need a balance above that; `consolidate` needs about 250 Tgas.

Round 2 gas note: since create_token is sent with 110 Tgas, `create_trial` needs more than 150 Tgas prepaid. At 150 the factory leg ran but the core's creation callback starved (`Exceeded the prepaid gas`), launch 7 stayed `Creating`, and the permissionless `finalize_creation` (after 10 minutes, tx 79rvNZJ9gJufQf9VGuyYPTtSG2aoVnFLkGwAE5ByCeXM) moved it to `Open`. Attach 300 Tgas (what the relayer, the sandbox tests and `seed.mjs` now use). Older runbooks that say 150 Tgas are stale for this wasm. Details: `rehearsal/ROUND2.md`.
