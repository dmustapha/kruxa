# Claims Ledger

Every README, video and X claim has one row. Status is `UNVERIFIED` until `scripts/verify-claims.sh` prints PASS for that id; the script re-derives each number from a command, never from a stored result.

| claim id | exact wording | recompute command | expected | status |
|---|---|---|---|---|
| C-01 | A launch whose committed total equals the soft cap and whose funders equal the minimum is a PASS | `cargo run -q -p kruxa-sim -- verdict --launch-id 1 --total-active 350000000 --funders 10 --soft-cap 350000000 --min-funders 10` | `outcome=PASS` | UNVERIFIED |
| C-02 | One micro-USDC below the soft cap is a FAIL | `cargo run -q -p kruxa-sim -- verdict --launch-id 1 --total-active 349999999 --funders 10 --soft-cap 350000000 --min-funders 10` | `outcome=FAIL(reasons=1)` | UNVERIFIED |
| C-03 | When a launch is oversubscribed, a 100 USDC buyer spends 40 USDC and is refunded 60 USDC | `cargo run -q -p kruxa-sim -- settle --total-active 12500000000 --hard-cap 5000000000 --commit 100000000` | `spend=40000000 refund=60000000` | UNVERIFIED |
| C-04 | The caps shown in the app are the caps the contract enforces | `near view <core> get_rule_set` (testnet deploy) | caps equal `Rules` defaults | UNVERIFIED |
| C-05 | The deployed wasm is the wasm in this repo | `sha256sum target/near/kruxa_core/kruxa_core.wasm` against `near contract view-code` hash (testnet deploy) | hashes equal | UNVERIFIED |
| C-06 | A creator cannot draw more than the stream allows | sandbox stream test output (testnet deploy) | output contains `STREAM_CAP` | UNVERIFIED |
| C-07 | About 0.63% of 655,770 launchpad tokens in one month graduated; the 98.6% rug figure is a vendor report, self-reported | `grep -n '0.63' research/launchpad-deep-research.md` (source file in the docs repo) | line cites arXiv 2602.14860 and the Solidus caveat | UNVERIFIED |
