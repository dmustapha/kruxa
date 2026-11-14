# Keeper and genesis watcher

Two off-chain daemons. Both are testnet/devnet only, dry-run by default, and need no database: every decision is read from chain state, so a crash or restart resumes by itself.

| Daemon | Code | What it does |
|---|---|---|
| Keeper | `services/keeper` | Drives the permissionless core methods for every launch and raises alerts (PRD C15, audit FG-16). |
| Watcher | `relayer/src/watcher.ts`, `relayer/src/watcher-cli.ts` | Drives the Solana genesis ceremony for PASS launches, PASS_SEEN to DONE (PRD C7, FL8a, audit FG-08). |

The watcher lives in `relayer/` because it calls the existing ceremony (`runCeremony`, signers, record writer) and needs `@solana/web3.js`; it re-implements no signing. The keeper has no Solana dependency, so it is its own package.

## Keeper

Order per launch, the only one that works (same as `scripts/core-testnet/keeper.mjs`):

1. Open and phase Ready: `settle`.
2. Passed: `settle_positions_page` from the first unsettled position until none is left (restart resumes at that seq, not 0).
3. `sweep_residue`.
4. `consolidate` (250 Tgas), `pay_launch_fee`, `pay_relay_fees`. `R_NOTHING_FREE` counts as success. A launch whose fee is paid and whose three calls all answered `R_NOTHING_FREE` is idle and costs no calls.
5. Failed: settle pages, then `claim_refund_batch` (permissionless, 300 Tgas, `KEEPER_REFUND_BATCH` holders per call) until nobody is due, then `dissolve` once ledger and positions are clear.

Every cycle it also:
- reads `solvency_report` and, at most every `KEEPER_SOLVENCY_EVERY_MS`, sends `check_solvency` (the core has a 30 s cooldown);
- reads `get_invariants` per launch;
- watches `inflight_native`, `inflight_intents` and `positions_unsettled` for a value that does not change for `KEEPER_STUCK_AFTER_MS`.

Rate limiting: at least `KEEPER_MIN_CALL_INTERVAL_MS` between RPC requests; on HTTP 429 it backs off 1 s, 2 s, 4 s ... up to 60 s and gives up after `KEEPER_MAX_RETRIES`. One launch is served by one holder at a time (in process; set `KEEPER_LOCK_DIR` to also lock across processes, stale after 10 min).

### Environment

| Variable | Meaning |
|---|---|
| `KEEPER_CORE`, `KEEPER_ACCOUNT_ID` | core contract and signer account. Must end `.testnet`. |
| `KEEPER_KEY_FILE` or `KEEPER_KEY` | key as a JSON file (`account_id` + `secret_key`/`private_key`) or an `ed25519:` string. Never logged, never loaded in dry-run. |
| `NEAR_RPC_URL` | default `https://test.rpc.fastnear.com`. A URL containing `mainnet` is refused. |
| `KEEPER_SEND=1` or `--send` | actually sign and send. Without it, dry-run. `--dry-run` always wins. |
| `ALERT_WEBHOOK_URL` | optional; one JSON POST per alert. Empty means log-only. |
| `KEEPER_INTERVAL_MS`, `KEEPER_SOLVENCY_EVERY_MS`, `KEEPER_STUCK_AFTER_MS`, `KEEPER_ALERT_REPEAT_MS`, `KEEPER_MAX_PAGES_PER_CYCLE` | tuning, defaults in `services/keeper/src/config.ts`. |
| `KRUXA_ALLOW_MAINNET=I_CONFIRMED_BY_DAMI` | the only way past the testnet guard, and only with sending on. Do not set it. |

### Run once

```
cd services/keeper
KEEPER_CORE=core3.kxi-root-1108.testnet KEEPER_ACCOUNT_ID=keeper.kxi-root-1108.testnet npx tsx src/cli.ts --once            # dry-run: prints dry_run_would_send lines
KEEPER_KEY_FILE=$HOME/.kruxa-secrets/keeper.json ... npx tsx src/cli.ts --once --send                                      # real
```

In dry-run only the next step of each launch is printed (later steps depend on state the unsent call would change).

### Reading the alerts

Output is one JSON object per line. Alerts have `"level":"alert"`, `"event":"alert"` and a `kind`:

| kind | Meaning | First move |
|---|---|---|
| `invariant_false` | `get_invariants.all_ok` is false; `failed` names the checks (`l1`, `i5` ...) and `<check>_err` the reason. | Treat as a bug or an attack. Pause via guardian. Read `docs/INVARIANTS.md`. |
| `intents_alert` | The core's Intents tripwire is set (from `get_invariants` or `solvency_report`). | Run `reconcile_intents`, compare with intents.near balance. |
| `solvency_false` | The last `check_solvency` found a leg short of its liabilities. | Same as above; read `solvency_report`. |
| `solvency_counters_mismatch` | Held counters differ from the recomputed sums (L6). | Same. |
| `leg_stuck` | A payout leg or unsettled positions have not moved for the threshold (`leg`, `value`, `stuck_ms`). | Look at the callback receipt on the explorer; resend the method. |
| `step_failed` | A permissionless call was refused with a code other than `R_NOTHING_FREE` (`method`, `code`). | The code says why (`R_WRONG_PHASE`, `R_NOT_CLEAR` ...). |
| `launch_error`, `solvency_check_error` | An RPC or parse error while serving a launch. The cycle continues. | Usually RPC; check the node. |

The same alert key repeats at most once per `KEEPER_ALERT_REPEAT_MS` and re-arms when the condition clears. The stuck timer lives in memory, so a restart restarts the clock.

## Watcher

Phase is a pure function of chain state:

| Phase | Chain state | Action |
|---|---|---|
| SKIPPED | not Passed, or no Solana plan | none |
| PASS_SEEN | Passed, positions unsettled or residue not swept | wait (the keeper finishes these) |
| READY | Passed, settled, swept, genesis `None` | run the ceremony: `commit_genesis`, tx1, tx2, `confirm_genesis`, write the record |
| COMMITTED | genesis committed, not confirmed | F0: resume (the ceremony skips the one-shot `commit_genesis` when the same key and complete root are already committed). F1: the key was memory-only, so alert `f1_genesis_stranded`; abort only when `WATCHER_AUTO_ABORT_F1=1` |
| ABORTED | aborted on chain | wait; only the owner can `reopen_genesis` |
| DONE | confirmed | none (alert once if this host has no record file) |

After a reopen the status is `None` again and the attempt budget resets. If the same F0 key already produced a sealed mint, `runCeremony` adopts it (verifies it against the spec and confirms, signing nothing).

"Has a Solana genesis plan" means: F0 mode, `lp_mirror_to_solana`, or at least one Solana buyer. `WATCHER_ALL=1` takes every Passed launch; `WATCHER_ONLY_LAUNCHES=3,4` always takes the named ids.

### Environment

`WATCHER_CORE` (`.testnet`), `WATCHER_CLUSTER` (`devnet` or `local`), `NEAR_TESTNET_RPC`, `KRUXA_NEAR_KEY` (relayer NEAR key file, must be the core's `genesis_relayer`), `KRUXA_RELAYER_KEY` (Solana funder), `WATCHER_SEND=1` or `--send`, `WATCHER_RECORD_DIR`, `WATCHER_MAX_ATTEMPTS`, `WATCHER_METADATA_URI_TEMPLATE`, `F0_BACKEND` (as for the relayer), `ALERT_WEBHOOK_URL`. Dry-run builds no signer and loads no key.

```
cd relayer
WATCHER_CORE=core3.kxi-root-1108.testnet npx tsx src/watcher-cli.ts --once            # dry-run
WATCHER_CORE=... npx tsx src/watcher-cli.ts --once --send                              # real devnet ceremony
```

## Deploy (Oracle VM)

`deploy/oracle/docker-compose.yml` has both services under the `daemons` profile, so a plain `docker compose up` does not start them.

```
cd deploy/oracle
cp keeper.env.example keeper.env; cp watcher.env.example watcher.env      # fill in, no secrets
mkdir -p /srv/kruxa/secrets && chmod 700 /srv/kruxa/secrets               # put key files here
docker compose --profile daemons up -d --build keeper watcher
docker compose logs -f keeper
```

`systemd/kruxa-daemons.service` does the same at boot. Both start in dry-run; set `KEEPER_SEND=1` / `WATCHER_SEND=1` and `docker compose --profile daemons up -d` again to send. Stop: `docker compose --profile daemons stop keeper watcher`.

## Failure modes

- RPC down or 429: the cycle logs `cycle_failed` or `rpc_429_backoff` and retries next tick. No state is lost.
- Keeper account out of NEAR: calls fail and surface as `step_failed`. Each call reserves its gas up front (100 Tgas is about 0.1 NEAR), so keep it above 0.4 NEAR.
- Two keepers at once: safe (every method is idempotent against chain state) but wasteful; use one.
- Watcher crash mid-ceremony: F0 resumes on restart; F1 is stranded by design (alert, then abort and owner reopen).
- Optimistic views can lag a just-sent receipt; the keeper re-checks next cycle instead of looping.
- Webhook down: logged as `webhook_failed`; the log line is still the record.
