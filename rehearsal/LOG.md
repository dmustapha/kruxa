# Rehearsal Log

| date | track | command | expected | observed | label | pass/fail |
|---|---|---|---|---|---|---|
| 2026-11-08 | baseline | `cargo test -p kruxa-math -p kruxa-logic` | 9 + 16 passed | 9 passed (kruxa-math), 16 passed (kruxa-logic) | SANDBOX | pass |
| 2026-11-08 | baseline | `./scripts/build.sh` | four wasm files, kruxa_core about 456,999 B | kruxa_core.wasm 456999 B sha256 96b6cb216cb56dc7bda2d9163349b363f6d80334196a20c103e6c3d76822ad1d; mock_ft 147849 B; mock_intents 163537 B; mock_factory 99745 B | SANDBOX | pass |
| 2026-11-08 | baseline | `./scripts/lint.sh` | `lint ok, kruxa_core.wasm 456999 bytes (budget 600000)` | `lint ok, kruxa_core.wasm   456999 bytes (budget 600000)` | SANDBOX | pass |
| 2026-11-08 | baseline | `/usr/bin/time -p ./scripts/test.sh --include-ignored` | 19 sandbox passed | 9 + 4 + 6 = 19 passed, 0 failed; wall 444.31 s (slowest test: holder cap, 168.40 s); no near-sandbox process left | SANDBOX | pass |
| 2026-11-08 | baseline | `cd app && npm test && npm run typecheck && npx next build` | 3 vitest passed, tsc clean, build ok | 3 passed; tsc clean; next build ok (routes /, /create, /demo, /launch/[id]) | RECORDED | pass |
| 2026-11-08 | toolchain | `rustc --version` in repo; `cargo +1.95.0 near --version` | rustc 1.95.0 (59807616e 2026-04-14); cargo-near-near 0.23.0 | same; node v24.10.0, npm 11.6.2 | RECORDED | pass |
| 2026-11-08 | R2 | `./scripts/rehearse.sh R2` | S1-B example 1: launch_fee=75000000, spend=40000000 refund=60000000 | launch_fee=75000000, spend=40000000 refund=60000000 | DRY-RUN | pass |
| 2026-11-08T13:15:07Z | A-4 | `./scripts/gate-freeze.sh candidate` | `sha256sum target/near/kruxa_core/kruxa_core.wasm` equals this row; after the deploy `view_code` sha256 must equal it | CANDIDATE sha256 c607839e4548e99b06f1bd83cbaee6d40da9f7474f0c7c3e653a4445ed45754d, 554862 bytes, commit 1a1e5ab, build reproducible container sourcescan/cargo-near:0.23.0-rust-1.99.1 (two runs identical; repository URL is a placeholder until DC-G) | RECORDED | pass |
