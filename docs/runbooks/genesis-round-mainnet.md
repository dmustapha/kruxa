# Runbook: $KRUXA Genesis Round on NEAR MAINNET

Status: DRAFT written 2026-11-14 for the owner (Dami). Nothing in this file has been run against mainnet. Every script it names defaults to dry-run.
Rulings it rests on (do not contradict): R-23 and C-03 (the first mainnet token is $KRUXA), R-F0F1 (F0 primary, F1 fallback), R-37 and C-06 (caps $1,000 per launch, $3,000 global, USDC), R-41 and C-09 (48 h Squads timelock kept), R-56 (three of the owner's own keys in three extension wallets, single-party, disclosed), DN-14 (100% of the LP seed on Kruxa's NEAR pool for round one), DN-15 (fee split), R-57 (target: open by 10:00 UTC on Nov 14), C-01 (per-action confirmation).

## 0. Rules of this runbook

1. **Per-action confirmation.** The agent never sends a mainnet transaction. For each step marked OWNER, the agent states the exact action in chat, the owner replies "go M3.1" (or the step id), and only then the owner runs the command with `!`. A "go" for one step is not a "go" for another (C-01). Background text is never a "go".
2. **One action per confirmation per script run.** Each script prints the full transaction (signer, receiver, method, args, deposit, gas, cost), prints a confirmation code, and sends only if BOTH `KRUXA_MAINNET_CONFIRMED=I_CONFIRM_DAMI_RUNS_THIS` is set AND the owner types `SEND <code>` for that exact summary. Set the env var on the same command line as the run, never in a saved file.
3. **Dry-run first, always.** Run the script without the env var, read the summary in chat with the agent, then run it again with the env var.
4. **Keys.** Only in files outside the repo, mode 600, path given per run in `KRUXA_KEY_FILE`. Never pasted in chat, never printed. The scripts refuse a key file inside the repo or readable by others.
5. **Throwaway keys** for the two plumbing tests only (R-36). The product accounts use fresh keys created by `create-account.mjs`.
6. **Process hygiene.** Nothing in this runbook starts a long-running process. The one compile (M4.1 validator) is short; if it runs longer than 15 minutes it is hung: kill it.
7. **Setup once:** `cp scripts/mainnet/values.example.env ~/.kruxa-secrets/mainnet/values.env`, fill it, then `set -a; . ~/.kruxa-secrets/mainnet/values.env; set +a`. Unknown values stay `REPLACE_ME`; the scripts refuse them.

Script reference (all in `scripts/mainnet/`): `account-plan.mjs` (read-only), `create-account.mjs`, `register-usdc.mjs`, `create-squads-vault.mjs`, `deploy-core.mjs`, `deploy-market.mjs`, `link.mjs`, `f0-key-mainnet.ts` (read-only), `create-token-and-trial.mjs`, `verify-mainnet.sh` (read-only). Tests: `node --test scripts/mainnet/mainnet.test.mjs` (stubs the network).

## 1. BLOCKERS: read before anything else

These are facts found in the repo on 2026-11-14. The round cannot open until the first three are cleared. Ask the agent to clear them; none needs a mainnet action.

| # | Blocker | Evidence | Needed |
|---|---|---|---|
| B1 | **The committed core rejects a 12 h commit window.** `Rules::ladder()` has `min_commit_secs: 86_400`. `cargo run -q -p kruxa-sim -- validate --params scripts/mainnet/kruxa-trial-params.json --profile ladder --brand` prints `R_WINDOW: commit_secs = 43200 violates 86400..=2592000`. GR-17 says "core change in progress", but the Nov 14 outstanding list (K1, K2) names only the freeze barrier and private init. The 12 h change is in no list I could find. | `crates/kruxa-logic/src/rules.rs:305`, validator output | A core rules change (min commit 43,200 s), a new reproducible build, new `artifacts/SHA256SUMS` and `BUILD-KIND`. `deploy-core.mjs` aborts on any wasm that does not match `SHA256SUMS`, so the sums must be updated first. Without it the only window the core accepts is 24 h or more: open at 10:00 closes at 10:00 on Nov 15, past the Nov 14 23:59 UTC deadline. |
| B2 | **Solana mainnet genesis path: built and guarded on branch `mainnet-solana`, NOT run against a real core.** `relayer/src/genesis-cli.ts --cluster mainnet-beta` exists behind five guards (confirm env, genesis hash, explicit dry-run off, spend cap, typed plan confirmation); read `docs/MAINNET-SOLANA-GENESIS.md` first. It needs a core initialised with profile `mainnet` (M3.1 now uses it; a core made with `ladder` commits a devnet spec and cannot be used), a real Squads vault with a 48 h lock, a funded Solana key (about 0.021 SOL per ceremony, cap 0.04 suggested) and a mainnet NEAR key. Untested: the NEAR mainnet F0 calls. | `docs/MAINNET-SOLANA-GENESIS.md` | Do not promise a Solana mint on mainnet before the owner has run the dry run and ruled on section 10 of that document. |
| B3 | **Gate G3 is NO-GO.** `scripts/gate-g3.sh` rows GR-7 (3 hardware wallets, ruled to extension wallets by R-56, still needs a recorded ruling and rehearsal), GR-8 (disclosure pages published), GR-9 (legal minimum; the owner must rule explicitly on leaving counsel review out), GR-10 (hard-coded Nov 11 18:00 limit, now FAIL unless the owner records a ruling), GR-12 (F0 three rehearsals) need evidence lines in `rehearsal/GATE-EVIDENCE.md`. | `scripts/gate-g3.sh` | Owner records waivers or rulings. HARD rows cannot be waived by this runbook. |
| B4 | **Token factory cost and refund are unproven on mainnet (O-9).** The core attaches a fixed 0.06 NEAR (`FACTORY_DEPOSIT_YOCTO`) with no setter. PRD reports 0.05 NEAR at `token.primitives.near` versus about 2.36 NEAR at `tkn.primitives.near` and never reconciled them. The factory account is not in repo evidence for mainnet. Creating any other token to probe is forbidden (R-23). | `contracts/core/src/lib.rs:40`, PRD X-4 | The first `create_trial` is itself the probe. If the factory wants more, the trial ends in `CreationFailed` and the bond is refundable; fixing it needs a redeploy. Accept that risk knowingly (M4). |
| B5 | **Hosted app is testnet only.** `docs/runbooks/hosting.md` says "testnet only". A mainnet build needs `NEXT_PUBLIC_NEAR_NETWORK=mainnet`, `NEXT_PUBLIC_MAINNET_CONFIRMED=DAMI-PER-ACTION-CONFIRMED`, and explicit `NEXT_PUBLIC_CORE_ACCOUNT`, `_USDC_ACCOUNT`, `_USDC_TOKEN_ID`, `_INTENTS_ACCOUNT`, `_MARKET_ACCOUNT` and `_INSTANT_ACCOUNT` (the instant launcher is not part of this round; the app refuses to start without it). | `app/lib/config.ts` | Pre-flight item P5. |
| B6 | **The mainnet factory, owner and account names are unknown.** Placeholders in `values.example.env`. `dimez.near` exists (ledger F-34) but is not ruled as the owner. Whether the owner controls `kruxa.near` (PRD says `core.kruxa.near`) is not in evidence; `create-account.mjs` only makes sub-accounts of the signer. | `values.example.env` | Owner supplies. |
| B7 | **Intent commit path on mainnet is unproven for the core.** Test 1 proved the withdraw (OV15) and Test 2 proved Chain Signatures, both with throwaway keys. Nothing has called the real `intents.near` into the real core on mainnet. Native-USDC commits (`ft_transfer_call`) are the safe path for the first backers; Solana-wallet commits via Intents carry the OV3 gap (Phantom `raw_ed25519` byte-exactness not proven). | `evidence/test1-ov15.json` | Disclose; steer first backers to NEAR USDC. |

Timing math if B1 is cleared. Open at T. Settings in `kruxa-trial-params.json`: open delay 0, commit 43,200 s (12 h), tail 3,600 s (1 h). Commit closes T+12 h, tail closes T+13 h, `settle` is callable after that. For `settle` before 23:59 UTC the open must happen by 10:00 UTC (23:00 settle, 59 minutes of margin). **Conflict to resolve:** the GR-17 table lists "walk window 12 hours" and "open delay 1 hour", while its own timing paragraph says 12 h commit plus a 1 h tail. 1 h delay plus 12 h commit plus 12 h tail ends at 11:00 UTC on Nov 15 for a 10:00 open. The params file follows the timing paragraph (delay 0, tail 1 h). The owner must confirm (item P3).

## 2. Pre-flight checklist (all must be ticked before M3)

| id | Item | Who | Status |
|---|---|---|---|
| P1 | B1 cleared: rules allow 12 h, new core wasm built reproducibly, `artifacts/SHA256SUMS` and `BUILD-KIND` updated, `kruxa-sim validate` prints `OK: no rule violated` | AGENT | open |
| P2 | Gate G3 rows (GR-1 to GR-17) each PASS or recorded in `rehearsal/GATE-EVIDENCE.md`. `./scripts/gate-g3.sh` is read-only. GR-1 tests, GR-2 devnet end to end, GR-4 factory evidence, GR-5 caps tests, GR-6 pause/freeze, GR-7 vault (see R-56), GR-8 disclosure pages, GR-9 legal minimum (explicit owner ruling that counsel review is left out), GR-10 timeline (new owner ruling for Nov 14 10:00 UTC), GR-11 per-action log, GR-12 F0 rehearsals, GR-14 core hash recorded with creator gate, GR-15 open_market handoff test, GR-17 numbers (below) | AGENT then OWNER rulings | open |
| P3 | GR-17 numbers accepted by the owner, including the delay/tail conflict in section 1: supply 1,000,000,000 (6 decimals), 60% sale, 25% LP seed, 10% creator (30 day cliff, 365 day vest), 5% backer bonus, hard cap $1,000, soft cap $350, min buy $20, per-wallet 5% of hard cap, 10 funders minimum, creator stream 30 days, launch fee 1.5% minimum $10; and the payout account (DN-9) | OWNER | open |
| P4 | Disclosure pages published on the host and the banner shows. Banner text (PRD Flow 10): "Genesis Round: capped launch of the Kruxa brand token. No independent audit has been done. The reserve vault is controlled by one person." The charter page lists: no audit, single-party reserve (three of the owner's own keys), publisher-updatable factory token, Intents force powers, relay fee, NEAR token exists before the verdict, Market-lite unreviewed | OWNER + AGENT | open |
| P5 | Hosting up on a mainnet build (B5), reachable over https, smoke-tested read-only (`scripts/smoke-hosted.sh`) | AGENT (read-only) + OWNER (hosting access) | open |
| P6 | Wallets: NEAR wallet holding about 15.1 NEAR (see M0 table) and a little USDC to commit a small test amount; Phantom, Solflare and Backpack installed, their three PUBLIC keys copied into `KRUXA_SQUADS_MEMBERS`; a Solana fee payer funded with about 0.3 SOL | OWNER | open |
| P7 | Key files created under `~/.kruxa-secrets/mainnet/` (mode 600): owner key, Solana fee-payer key. The agent never sees them | OWNER | open |
| P8 | `values.env` filled; `node --test scripts/mainnet/mainnet.test.mjs` green; `node scripts/mainnet/account-plan.mjs` run read-only and its output reviewed in chat | OWNER + AGENT | open |
| P9 | The agent's read-only probe of external contracts matches (M0.1): USDC bounds, `intents.near` code hash `BtA1BEFNS619KkvXFsgcpQ21Tb5yMm32aaUkn7xNothk`, `v1.signer` version 3.17.0, the factory exists and `kruxa.<factory>` is free | AGENT | open |

## 3. Stages

### M0. Accounts and funding plan

Storage costs 1e-5 NEAR per byte. Core wasm 655,376 B locks 6.55 NEAR; market wasm 261,077 B locks 2.61 NEAR. `account-plan.mjs` derives the table below from the actual file sizes plus 0.5 NEAR margin per contract.

| Account | Role | Fund (NEAR) | Notes |
|---|---|---|---|
| owner (`KRUXA_OWNER`) | owner of core and market, signs `create_trial`, funds everything | 15.1 total | Core 7.1 + market 3.2 + 3 small accounts 0.3 + relayer 0.5 + trial deposit ceiling 2 + gas 1 + reserve 1 |
| core (`KRUXA_CORE`) | the Genesis Round contract | 7.1 | Created by `create-account.mjs` with a full-access key |
| market (`KRUXA_MARKET`) | Market-lite, receives the LP seed | 3.2 | |
| guardian, treasury, relay-fees | helper accounts, no contract | 0.1 each | Each must be registered on USDC |
| genesis-relayer (`KRUXA_GENESIS_RELAYER`) | relayer account for genesis methods | 0.5 | Function-call key only, limited to the relayer methods. A key it needs later, not now |
| payout (`KRUXA_PAYOUT`) | creator stream and USDC payout recipient (DN-9) | 0 (existing account) | Must be registered on USDC |

The creator of the trial is the owner account (the contract's creator gate lets only the owner create until `open_beta`). The owner account creates the trial; it does not need USDC for that.

**M0.1 Read-only probe of mainnet constants.** WHO: AGENT. COST: 0. Command: `node scripts/mainnet/account-plan.mjs`. PROVES: USDC contract `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` answers with registration min = max 0.00125 NEAR; `intents.near` code hash equals the pinned value; `v1.signer` reports 3.17.0; the factory account exists and `kruxa.<factory>` is free; the funding shortfall per account. EXPECT: a table plus "MATCHES the pinned hash". ROLLBACK: none (read-only). Stop if the hash differs.

**M0.2 Create and fund each account (one run per account).** WHO: OWNER, per-action confirmation each. COST: the funding amount in the table plus about 0.003 NEAR gas, per account; total about 11.3 NEAR moved (7.1 + 3.2 + 0.3 + 0.5) and 0.02 NEAR of gas. Command, one account at a time:
`KRUXA_KEY_FILE=~/.kruxa-secrets/mainnet/owner.json KRUXA_NEW_KEY_FILE=~/.kruxa-secrets/mainnet/core.json node scripts/mainnet/create-account.mjs core.<owner> 7.1` (dry-run), then the same line prefixed with `KRUXA_MAINNET_CONFIRMED=I_CONFIRM_DAMI_RUNS_THIS`. Repeat for market (3.2), guardian, treasury, relay-fees (0.1 each) and genesis-relayer (0.5). PROVES: the account exists on chain with exactly one key you hold. EXPECT: `SENT tx=...` and a key file at the given path, mode 600; the private key is never printed. The key file is written before the send, so a lost response cannot strand funds. ROLLBACK: a created account can be deleted with the owner as beneficiary (a separate owner action, `near delete-account`), recovering the funding minus gas. ABORT: if two accounts exist but a third fails, stop; the rest is harmless.

**M0.3 Register accounts on native USDC (one run per account).** WHO: OWNER, each confirmed. COST: 0.00125 NEAR deposit per account (refund is not available; this is the storage stake) plus gas about 0.001; for core, market, treasury, relay-fees, guardian, payout = 0.0075 NEAR in total. Command: `KRUXA_KEY_FILE=~/.kruxa-secrets/mainnet/owner.json node scripts/mainnet/register-usdc.mjs <account>`. Do core and market only after they exist (M0.2). PROVES: `storage_balance_of` is non-null, so USDC transfers to the core will not bounce. EXPECT: `SENT tx=...`, or "already registered". ROLLBACK: `storage_unregister` by that account (rarely worth it).

### M1. The two plumbing tests (already authorized; already recorded)

Both are recorded as PASS with throwaway keys, so M1 is evidence review, not new spending, unless the owner wants a re-run.

- **Intents $1 deposit and withdraw (Test 1).** Recorded in `evidence/test1-ov15.json`: `ft_withdraw` from `intents.near` landed on a fresh Solana address, tx `3KLVemdjr387BsqJiuuV9By9VXzeri6GRFwy3HMRT6ko`, bridge fee fixed at 0.03 USDC (30000 micro-USDC; a withdrawal of exactly 0.03 nets zero). Not proven: OV3 (Phantom byte-exactness).
- **Chain Signatures dust test (Test 2).** Recorded: T0 key match, T1 signed Solana transfer, T2 20 of 20 signatures (median 13.5 s), T3 1,150-byte payload, T5 policy refusal; T4 is devnet. Source `warroom/signed-tests/state/test2.json`.
- Sweeps of the leftover throwaway balances were NOT done, held at the owner's instruction (ledger section 9).

**M1.1 (optional re-run).** WHO: OWNER with `!`, per-action. COST: Test 1 at most $1 (about 1 USDC plus under 0.01 NEAR gas); Test 2 about 2 NEAR plus 0.01 SOL, throwaway keys, funded by the owner. The kit is `warroom/signed-tests/` (dry-run by default, `--send` broadcasts): `npm run guard` (proves no mint code), `npm run preflight`, `node src/test1.ts ov15` (dry-run) then `node src/test1.ts ov15 --send`, `node src/test2.ts t1` then `--send`, `node src/test2.ts t2 --send`, `node src/test2.ts t5 --send`. Sweep: `node src/sweep.ts t1 --sol 3Jnm9LqQW2vHEkjCx48HXZfWAQDvdKkPod4vQ41qQpNJ --near <owner>` (dry-run, then `--send`). PROVES: Intents withdrawal and MPC signing still work today. ROLLBACK: sweep returns most of the balances. SKIP this step if time is short: the recorded results stand, and it does not gate M3. The scope stays: no token or mint on mainnet.

### M2. Squads vault on Solana mainnet

3 members = the owner's three extension-wallet public keys (Phantom, Solflare, Backpack), threshold 2, 48 h time lock (172,800 s, hard-coded, the script refuses anything else), no config authority, no rent collector. DISCLOSED as single-party (R-56): all three keys are one person's, so the 2-of-3 protects against one compromised wallet, not against the owner.

**M2.1 Create the vault.** WHO: OWNER, per-action confirmation. COST: Squads creation fee read live from the program config (the script prints it) plus account rent plus a 5,000 lamport transaction fee; script cap 0.2 SOL, expect well under it. Fee payer funded with about 0.3 SOL. Command: `KRUXA_SOL_KEY_FILE=~/.kruxa-secrets/mainnet/sol-feepayer.json node scripts/mainnet/create-squads-vault.mjs` (dry-run), then with `KRUXA_MAINNET_CONFIRMED=I_CONFIRM_DAMI_RUNS_THIS`. The script checks the RPC genesis hash against `KRUXA_SOL_MAINNET_GENESIS_HASH` (owner to confirm that value; the repo only holds the devnet hash). The member wallets sign nothing. PROVES: a 2-of-3 Squads v4 multisig with a 48 h lock on Solana mainnet. EXPECT: `multisig PDA`, `vault PDA index 0`, `threshold 2 time_lock 172800`. Put the multisig PDA into `KRUXA_SQUADS_MULTISIG`. This script is NOT runnable against mainnet by the agent and its send path has no automated test (the Squads code is the same as `tools/squads/vault.ts`, rehearsed on devnet). ROLLBACK: none on chain; the multisig can sit unused. Do a devnet rehearsal first if time allows: `npx tsx tools/squads/create-vault.ts --cluster devnet --time-lock 172800`.

**M2.2 Check.** WHO: AGENT, read-only: read the multisig account from a Solana RPC and confirm members, threshold 2, time lock 172800. Compare the three members with the keys in `KRUXA_SQUADS_MEMBERS`.

### M3. Core and market deploy, link, caps

**M3.1 Core: deploy plus init in ONE transaction.** WHO: OWNER, per-action. COST: gas about 0.02 NEAR (script cap 0.5); 6.55 NEAR is a storage stake held on the core account, not spent. The transaction is `DeployContract(kruxa_core.wasm)` plus `new { owner, guardian, treasury, relay_fees, usdc, intents, factory, profile: "mainnet" }`, signed by the core account. One transaction means nobody can call `new` between deploy and init (the takeover window in K2). `profile: "mainnet"` (same capped ladder rules; the only profile whose genesis spec targets Solana mainnet, see docs/MAINNET-SOLANA-GENESIS.md) closes the creator gate to everyone but the owner (D-1, `R_CREATOR_GATE`) and fixes caps in code. Command: `KRUXA_KEY_FILE=~/.kruxa-secrets/mainnet/core.json node scripts/mainnet/deploy-core.mjs`. The script hashes the file and compares it to `artifacts/SHA256SUMS` BEFORE sending (abort on mismatch), refuses a core account that already has code, then after the send compares `view_code` on chain with the same value (hard failure on mismatch) and reads `get_config`. PROVES: the deployed bytes are the audited bytes. EXPECT: `CODE MATCH`, `profile mainnet, creator_gate true, global_cap 3000000000` (that is $3,000 in micro-USDC). The core keeps its full-access key (disclosed; `verify.sh` prints it as `KEYS:`). ROLLBACK: the core holds no funds yet; redeploy over it (same key) or delete the account to the owner. ABORT if `CODE MISMATCH`: treat the account as untrusted, delete it, tell the owner.

**M3.2 Register core on USDC.** WHO: OWNER, per-action. See M0.3 (core must be registered before any commit).

**M3.3 Link the genesis relayer.** WHO: OWNER, per-action. COST: about 0.001 NEAR gas. Command: `KRUXA_KEY_FILE=~/.kruxa-secrets/mainnet/owner.json node scripts/mainnet/link.mjs set_genesis_relayer`. PROVES: `get_config.genesis_relayer` equals the relayer account. Skips itself if already set. ROLLBACK: call again with another account (owner only).

**M3.4 Market: deploy plus init in ONE transaction.** WHO: OWNER, per-action. COST: gas about 0.02 NEAR; stake 2.61 NEAR on the market account. Command: `KRUXA_KEY_FILE=~/.kruxa-secrets/mainnet/market.json node scripts/mainnet/deploy-market.mjs`. Reserve caps stay at the contract defaults, 5,000 per pool and 15,000 global (DN-17 interim). Same hash checks. The market wasm is non-reproducible (`BUILD-KIND`), so its hash proves "these bytes", not "this source". ROLLBACK as M3.1.

**M3.5 Link the market.** WHO: OWNER, per-action. `link.mjs set_market`. Must happen before the first `open_market`; the core locks it after that. COST about 0.001 NEAR.

**M3.6 Caps.** The caps are in code. Verify, do not set: `get_config` shows `global_cap` 3,000,000,000 (micro-USDC, $3,000); the per-launch $1,000 cap comes from the `ladder` rules (`max_hard_cap` 1,000 USDC, enforced by `validate_params`). WHO: AGENT, read-only: `curl` a `call_function` on `get_config` or run `./scripts/mainnet/verify-mainnet.sh ops` and read the config in `account-plan.mjs`. EXPECT: `global_cap` equals 3000000000, `profile` ladder, `creator_gate` true, `pause` None. Raising any cap is timelocked 7 days (C-06). ABORT if any value differs.

**M3.7 Check code.** WHO: AGENT, read-only: `./scripts/mainnet/verify-mainnet.sh ops` prints `KEYS:` and `CODE: ... MATCH` for core and market. Record the output in `evidence/` (the agent may write that after the owner approves).

### M4. Create the $KRUXA token and the trial

**M4.1 Validate the params.** WHO: AGENT, read-only, short compile. Command: `cargo run -q -p kruxa-sim -- validate --params scripts/mainnet/kruxa-trial-params.json --profile ladder --brand`. EXPECT: `OK: no rule violated`. Today it prints `R_WINDOW` (blocker B1). `create-token-and-trial.mjs` runs the same check itself and refuses on any violation. File contents (GR-17): symbol `KRUXA`, name `Kruxa`, supply 1,000,000,000, sale 6000 bps, LP 2500, creator 1000, backer 500, hard cap `1000000000` ($1,000), soft cap `350000000`, min buy `20000000`, per-wallet 500 bps, 10 funders, delay 0, commit 43,200 s, tail 3,600 s, stream 30 days, standard fees.

**M4.2 Derive the F0 mint key (F0 only).** WHO: AGENT or OWNER, read-only, after M3.1. COST: 0. Command: `npx --prefix relayer tsx scripts/mainnet/f0-key-mainnet.ts --core $KRUXA_CORE --launch 1`. EXPECT: 64 hex characters; put it in `KRUXA_F0_MINT_PUBKEY_HEX` and keep `KRUXA_F0_LAUNCH_ID=1`. The script `create-token-and-trial.mjs` refuses if the next launch id differs. This tool is a mainnet twin of a tested testnet tool and has not been run on mainnet: compare against `near view v1.signer public_key '{"domain_id":1}'` for a sanity check. If you choose F1 instead (`KRUXA_GENESIS_MODE=F1`), skip this step. The plan is fixed once the trial exists. Note B2: neither mode can finish genesis on mainnet today.

**M4.3 Create the token and the trial in ONE transaction.** WHO: OWNER, per-action. COST: attached deposit equals the live `required_deposit` view (position bond plus 0.06 NEAR factory deposit plus 0.00125 USDC registration); for 50 holders about 0.27 NEAR, ceiling for 500 holders 1.7 NEAR; script cap 2 NEAR; gas 300 Tgas prepaid, unused refunded, about 0.03 NEAR. Command: `KRUXA_KEY_FILE=~/.kruxa-secrets/mainnet/owner.json node scripts/mainnet/create-token-and-trial.mjs`. The core calls the factory's `create_token` itself (110 Tgas) and mints the whole supply to itself; the token is `kruxa.<factory>`. The script refuses: any symbol other than KRUXA, an open creator gate, a paused core, funds already held, an existing `kruxa.<factory>`, a deposit above the cap, a factory that differs from the core's. PROVES: the round exists on chain. EXPECT: `SENT tx=...`, then `get_state 1` shows `status` `Open` within a minute (the factory callback). If it stays `Creating` for 10 minutes call `finalize_creation` (permissionless). If `CreationFailed` (blocker B4): the bond is refundable with `reclaim_bond`; do not retry blindly, ask the agent to read the factory's receipt first. ROLLBACK before anyone commits: `cancel_trial` (creator) then `reclaim_bond`. After commits exist the Walk is the exit (refunds are pull-based). `open_delay_secs` is 0, so commits are open as soon as the state is `Open`: the banner, hosting and wallets (P4 to P7) must already be done.

**M4.4 Register the payout account on USDC** (M0.3) if not done; it must be registered before the first stream draw.

### M5. Verify, banner, disclosures

**M5.1 Verify read-only.** WHO: AGENT. COST: 0. `./scripts/mainnet/verify-mainnet.sh ops` (KEYS and CODE lines). `./scripts/mainnet/verify-mainnet.sh launch 1` while the round is open: exit 3 (pending) is NORMAL; exit 2 (mismatch) or 4 (RPC problem) is a stop. The Solana half needs the genesis record file, which does not exist until genesis (B2), so those rows cannot pass yet. The wrapper refuses non-mainnet RPCs and points `verify.sh` at Solana mainnet. ROLLBACK: none.

**M5.2 Banner and pages.** WHO: AGENT (read-only fetch of the hosted pages) and OWNER (hosting). Confirm on the live URL: the Genesis Round banner (P4), the `/charter` disclosure list, the risk and terms pages, the caps ($1,000, $3,000), the commit end time and tail end time, and the 48 h Squads lock described as a live countdown for the reserve. Confirm the page says "open" and nothing more; it must not say the round settled (GR-17 timing note).

**M5.3 First commit smoke test.** WHO: OWNER, a small NEAR USDC `ft_transfer_call` of the minimum buy ($20) from a personal wallet, per-action. Optional but recommended: proves `ft_on_transfer` works with the real USDC. ROLLBACK: the Walk (during the commit window and tail) returns it.

### M6. What happens at close (follow-up for the owner; not runnable today)

1. **Commit window closes** at T+12 h (22:00 UTC for a 10:00 open). No new commits. The Walk window (tail, 1 h) lets backers leave until T+13 h.
2. **`settle`** (permissionless, anyone, after the tail ends): the deterministic verdict. PASS needs the soft cap ($350) and at least 10 funders. FAIL refunds everyone by pull (`claim_refund`, `claim_refund_batch`) and dissolves. The keeper script `scripts/keeper.sh` does settle, position pages, residue sweep, consolidation and the launch fee; run it as the owner's decision, dry-run by default.
3. **After a PASS:** launch fee about $15, LP seed about $416.67 USDC with 250,000,000 $KRUXA, creator stream about $568.33 USDC over 30 days. These figures come from GR-17 for a fully raised $1,000; a smaller raise scales.
4. **Market (DN-14):** anyone can call `open_market` after settle, every position settled, `sweep_residue`, `consolidate` and `pay_launch_fee`; 100% of the LP seed goes to Kruxa's NEAR pool on the market contract and stays there (permanent LP inside the contract, no human timelock). Never inside `settle`.
5. **Genesis (Solana mint), blocked by B2:** F0 (the core asks `v1.signer` to sign the Solana genesis; `register_f0_message` then `sign_genesis`) or F1 (the relayer signs once and the authorities are nulled). The Solana mainnet driver exists but has not been run (see B2). The 48 h Squads timelock gates only the Solana side of the LP seed (the reserve in the vault), and Meteora DAMM v2 is the Solana venue (DN-22: Raydium CPMM first fallback, Orca second). Expect all of this after the Nov 14 deadline and disclose it.
6. **Then:** `./scripts/mainnet/verify-mainnet.sh launch 1` should reach exit 0 once genesis is recorded. Only then does the capped third-party beta become possible (`open_beta`, one-way, and it needs two named independent Squads signers, DN-21).

## 4. Cost summary (mainnet actions, estimates)

| Step | Action | Spend (NEAR unless noted) | Locked / moved |
|---|---|---|---|
| M0.2 | create and fund 6 accounts | gas about 0.02 | 11.3 moved to the new accounts |
| M0.3 | USDC registration x6 | 0.0075 | |
| M1.1 | optional plumbing re-run | Test 1 at most $1; Test 2 about 2 NEAR + 0.01 SOL | throwaway keys |
| M2.1 | Squads vault | under 0.2 SOL (cap), fee read live | |
| M3.1 | core deploy and init | about 0.02 | 6.55 staked |
| M3.3, M3.5 | link relayer, link market | about 0.002 | |
| M3.4 | market deploy and init | about 0.02 | 2.61 staked |
| M4.3 | create token and trial | about 0.03 gas plus the deposit (about 0.27, ceiling 2) | bond refundable; factory deposit 0.06 not refundable |
| Total | | roughly 15.1 NEAR held by the owner, of which about 0.2 to 0.4 is spent for good and the rest is stake or refundable bond; plus under 0.3 SOL | |

## 5. ABORT section

Abort means: stop, send nothing more, tell the agent, and let the agent read the chain before anything else moves.

- **Any script prints `REFUSING`, `ABORT` or `MISMATCH`:** that is the guard working. Do not bypass it. A code hash mismatch after the deploy means the account is untrusted: delete it and start over.
- **Before M3.1:** nothing irreversible exists except account funding and the Squads vault; all recoverable.
- **After M3.1, before M4.3:** the core holds only its stake; delete the core and market accounts to the owner, or leave them dormant.
- **After M4.3, no commits yet:** `cancel_trial` then `reclaim_bond` (owner). The token account stays as a dead token; disclose it.
- **After commits exist:** `guardian` or owner can `pause` (stops new risk, never exits) and `freeze` (the guardian cannot re-arm for 7 days once K1 lands); the Walk and pull refunds stay open. Nobody can take funds out except through the contract rules.
- **A signing mistake or leaked key:** pause first, then rotate keys; the core's full-access key is the owner's and is disclosed.
- **Timeline slip:** if the open slips past 10:00 UTC the round cannot settle before the deadline. Opening later is allowed only as "open and collecting"; say so and nothing more. Do not shorten the 48 h lock (X-07).
- **The README, post and submission must not claim a settled round, a Solana mint, a Meteora pool or an audit** unless the chain shows them. If the round is not opened, say "rehearsed on testnet and devnet, mainnet round not opened".

## 6. Items the owner must supply

`KRUXA_OWNER` (and its key file), `KRUXA_PAYOUT` (DN-9), `KRUXA_FACTORY` (confirm `token.primitives.near`), the names for core, market, guardian, treasury, relay-fees and genesis-relayer, the three Squads member public keys, `KRUXA_SOL_MAINNET_GENESIS_HASH`, a Solana fee-payer key file with about 0.3 SOL, the metadata URI for the token, an explicit ruling on GR-9 (legal minimum) and GR-10 (timeline), a decision on F0 versus F1, and confirmation of the delay/tail conflict in section 1.
