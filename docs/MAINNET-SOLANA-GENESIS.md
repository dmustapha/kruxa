# Solana MAINNET genesis for $KRUXA: what differs from the devnet rehearsal

Written 2026-11-14 on branch `mainnet-solana`. Everything here was read from mainnet-beta with read-only RPC calls (account lookups, program dumps, `getMinimumBalanceForRentExemption`, `getRecentPrioritizationFees`, and `simulateTransaction` with `sigVerify: false` against a funded public account, which signs and sends nothing). No transaction was sent, signed or funded on any mainnet, and no key was used.

Rulings this rests on: R-F0F1 (F0 primary, F1 fallback), R-23 and C-03 (the first mainnet token is $KRUXA), R-41 and C-09 (48 h Squads timelock), DN-14 (100% of the LP seed on Kruxa's NEAR pool for round one), C-01 (per-action confirmation).

## 0. Verdict

A mainnet mint is now mechanically possible and guarded, but it is **not safe to run today** until the items in section 10 are closed. The two that matter most:

1. **The mainnet core script initialises the core with profile `ladder`, and only profile `mainnet` commits a Solana mainnet spec.** `contracts/core/src/genesis.rs` `build_spec` writes chain `solana-devnet` and the devnet genesis hash for every profile except `mainnet`. A core made by the old `deploy-core.mjs` could never pass the new mainnet guard (it refuses a spec that is not `solana-mainnet`). Fixed in this branch (`deploy-core.mjs` and `create-token-and-trial.mjs` now use `mainnet`; same rules and creator gate, no wasm change). If the owner already ran M3.1 with `ladder`, that core cannot be re-initialised and the Solana genesis of that core is blocked.
2. **Nothing has run against a real NEAR mainnet core.** The F0 path through `v1.signer` on NEAR mainnet (register_f0_message, sign_genesis, confirm_genesis) is new code with unit tests only. The Solana half was proven locally against the real program bytes (section 7).

## 1. Devnet rehearsal versus mainnet

| Item | Devnet rehearsal | Mainnet |
|---|---|---|
| Jito distributor | A PATCHED COPY at a program id we control (`scripts/genesis-devnet-setup.sh` rewrites the 32 declared-id bytes; upgradeable by our relayer key; about 3.17 SOL rent) | The real program `mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv`, **immutable**. Nothing to deploy, nothing to patch. `JITO_PROGRAM` must be unset |
| Metaplex Token Metadata | devnet deployment | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`, immutable |
| Genesis hash | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` (read back from two independent RPCs) |
| Spec chain written by the core | `solana-devnet` | `solana-mainnet`, **only if the core profile is `mainnet`** (section 0) |
| Rent per byte | Same parameter as mainnet today (5,080 lamports per byte); the local validator still uses the older 6,960 | 5,080 (`getMinimumBalanceForRentExemption(165)` = 1,488,440) |
| Metaplex creation fee | Charged | 10,000,000 lamports into the metadata account, same binary |
| Funder | `~/.kruxa-secrets/genesis/relayer-devnet.json`, airdropped devnet SOL | A real SOL key file (`KRUXA_SOLANA_FUNDER_KEY`, mode 600, outside the repo) holding real SOL |
| NEAR side | `*.testnet` core, `v1.signer-prod.testnet`, testnet key | mainnet core, `v1.signer`, a mainnet key (`KRUXA_KEY_FILE`); the core picks `v1.signer` itself when its account does not end `.testnet` |
| Squads reserve vault | made by the CLI with a 60 s lock | made earlier by `scripts/mainnet/create-squads-vault.mjs`, 48 h lock (172,800 s); the CLI refuses less before funding G |
| Metadata URI | `https://kruxa.example/rehearsal/N.json` | the real https URL the core committed to (`KRUXA_METADATA_URI`); the spec stores its sha256 and the ceremony refuses a mismatch |
| Claim test | one throwaway holder claims | none; real holders claim later |
| RPC | `api.devnet.solana.com` | `SOL_MAINNET_RPC` (the public RPC returned 429 during this work; use a paid or private RPC) |

## 2. Program identity and who can upgrade it (DISCLOSE)

Read 2026-11-14 with `solana program show` and a raw `getAccountInfo` of each ProgramData header (the option byte at offset 12 is 0, so no upgrade authority). Cross-checked on a second independent RPC (`solana-rpc.publicnode.com`).

| Program | Id | Upgrade authority | Last deployed slot | ELF bytes | sha256 of `solana program dump` |
|---|---|---|---|---|---|
| Jito merkle-distributor | `mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv` | none (immutable) | 234207504 | 623,056 | `51043e9794e69f0b071d741abd29fc274694ab60e412a1ed6d0dd38e258703ac` |
| Metaplex Token Metadata | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` | none (immutable) | 380725176 | 793,991 | `31f0a627dba051a938de650464e55cc5397a4be0fd496929c1f9cf02fe5e9011` |
| Squads v4 | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` | none (immutable) | 302582236 | 1,470,416 | not pinned in code |
| SPL Token (Tokenkeg) | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | none (immutable) | not recorded | not recorded | not pinned |
| Associated Token | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | BPFLoader2 (non-upgradeable) | | | not pinned |

Trust this implies, to be disclosed:

- Nobody can upgrade Jito, Metaplex Token Metadata or Squads. The trust is in the code as deployed and in the audit status of each, which this work did not verify. Jito's distributor is a general airdrop program written by the Jito team; we use it unchanged.
- The `JITO_MAINNET` constant is the only distributor the mainnet path will accept. A patched copy at a different id (the devnet setup) is refused before anything is sent. The relayer pins the two ELF hashes above and refuses on any difference or any non-null upgrade authority (`relayer/src/mainnet-programs.ts`).
- Nothing in this repo has an admin key on the distributor: `set_admin` hands it to the incinerator `1nc1nerator11111111111111111111111111111111` in the same transaction that creates it. After that, nobody can change the clawback receiver or the admin. The clawback receiver is the reserve ATA owned by the Squads vault.
- The tokens are classic SPL (Tokenkeg), not Token-2022. This is forced: the Jito distributor's `tokenProgram` account is the classic token program and its vault is an associated token account of that program. The spec check also refuses extensions (mint account must be exactly 82 bytes).

## 3. Instruction and account layout against the real program

I dumped the real program and read its on-chain Anchor IDL (account `8MPBYNbUFww5mWeFnvYQZ2KgMZGUstAyiJ3LyeGxctYS`, version 0.0.1, instructions newDistributor, newClaim, claimLocked, clawback, setClawbackReceiver, setAdmin) and compared with `relayer/src/compile.ts`.

| Instruction | IDL accounts (in order) | compile.ts | Match |
|---|---|---|---|
| `new_distributor` (disc `208b70ab0002e19b` = sha256("global:new_distributor")[0..8]) | distributor (w), clawbackReceiver (w), mint, tokenVault (w), admin (w, signer), systemProgram, associatedTokenProgram, tokenProgram | distributor w, reserveAta w, mint, vault w, G signer w, system, ATA, Tokenkeg | yes, same order and flags |
| `new_distributor` args | version u64, root [u8;32], maxTotalClaim u64, maxNumNodes u64, startVestingTs i64, endVestingTs i64, clawbackStartTs i64 | the same seven fields in the same order | yes |
| `set_admin` (disc `fba300345bc2bb5c`) | distributor (w), admin (w, signer), newAdmin (w) | distributor w, G signer w, incinerator w | yes |
| `new_claim` (used by `claim.ts` only) | distributor, claimStatus, from, to, claimant (signer), tokenProgram, systemProgram | not used by the ceremony | not checked |
| Metaplex `CreateMetadataAccountV3` (tag 33) | metadata (w), mint, mintAuthority (signer), payer (signer, w), updateAuthority, system | metadata w, mint, G s, G s w, G s, system | accepted by the real program (simulated on mainnet, `err: null`) |

**No mismatch found.** Caveat: a byte search for the discriminators in the ELF finds none (Anchor compiles them into code as immediates), so the discriminators were not proven by scanning the binary. They were proven by execution: the full ceremony (tx1 and tx2, including `new_distributor`, `set_admin` and a real `new_claim`) ran against the real binary on a local validator (section 7), and the Metaplex and token parts of tx1 were simulated by mainnet itself.

Distributor timing: `start = clock + 300 s`, end = start + 60 s, clawback = start + `clawbackDays` days. The program rejects a start in the past (error 6016) and a clawback less than one day after vesting end (6010). `clock` is read after `commit_genesis` and before funding, so tx2 must land within 300 s of that. Measured F0 signing on testnet was 14 to 21 s per transaction (`evidence/genesis`). If the MPC signer is much slower on mainnet, tx2 fails with 6016 and the mint is left created and unsealed; the F0 resume path recompiles with a fresh clock.

## 4. Cost of one ceremony

Rent per byte on mainnet-beta today is 5,080 lamports (`getMinimumBalanceForRentExemption`). `compile.ts` creates the mint account with an explicit 1,461,600 lamports (the older 6,960 rate for 82 bytes), which is more than the 1,066,800 minimum and is allowed.

| Item | Lamports | Source |
|---|---|---|
| Mint account (explicit in compile.ts) | 1,461,600 | code |
| Reserve ATA, 165 bytes (owner: the Squads vault) | 1,488,440 | live rent |
| Metaplex metadata account: 607 bytes rent 3,733,800 plus 10,000,000 creation fee | 13,733,800 | simulation on mainnet |
| Subtotal tx1 (no distributor) | **16,683,840** | simulation: G balance delta minus the 5,150 fee, identical for three different name, symbol and uri lengths |
| Vault ATA, 165 bytes | 1,488,440 | live rent |
| Distributor PDA, 240 bytes | 1,869,440 | live rent, matches devnet |
| Subtotal tx2 | 3,357,880 | |
| Non-fee total with distributor | **20,041,720** | equals the devnet constant |
| G rent-exempt dust, kept forever | 890,880 | verify C16 allows it |
| Base fees, two transactions | 10,000 | |
| Priority fee at 1,000 micro-lamports per CU (150,000 + 250,000 CU limits) | 400 | |
| **G is funded with** | **20,943,000 (0.020943 SOL)** | `genesisCostLamports("mainnet-beta", true, 1000)` |
| Funder fee for the funding transfer | 5,000 | |
| **Funder spend per ceremony** | **20,948,000 (0.020948 SOL)** | |
| Without a distributor (no Solana buyers) | 17,585,120 into G | |

What is gone for good: the 10,000,000 Metaplex fee, the rent of the accounts (none is reclaimable: the mint and metadata are immutable, the ATAs belong to the vault and the distributor), and 890,880 stranded in G. Compute used: tx1 59,552 CU (limit 150,000), tx2 116,754 CU (limit 250,000), both well under half of the limit.

The owner's measured devnet figure of 0.0284 SOL for one F0 run is about 0.0075 SOL above this number. I could not reproduce it from the code or from the evidence files. The most likely explanation is that the devnet figure includes something besides the ceremony, such as the Squads vault creation the CLI does with `--squads-time-lock`, but I did not prove it. The spend cap should therefore be set with headroom (suggest `KRUXA_SOLANA_SPEND_CAP_SOL=0.04`); the cap is checked against the funding amount plus its fee, not against the Squads vault, which mainnet creates separately.

Priority fees: all 150 recent slots returned a prioritization fee of 0 (read from `getRecentPrioritizationFees`), so 1,000 micro-lamports per CU is above the floor. Under congestion a transaction at that price can be dropped; raise it with `KRUXA_SOLANA_PRIORITY_MICROLAMPORTS` (0 to 200,000; at 200,000 the extra cost is 80,000 lamports). The price is written to the record so the verifier recompiles with it.

**Calibration hazard.** G is funded with the exact calibrated amount and F0 cannot sweep leftovers (its policy gate signs only the two committed transactions). If rent or the Metaplex fee changes, a short G fails the transaction loudly and a long G leaves G above the C16 bound. Rent per byte was 6,960 in older code and is 5,080 now, so this does move. The ceremony therefore recomputes the cost from live rent just before funding (`assertRentCalibration`) and refuses if it differs from the calibrated 20,041,720 or 16,683,840.

### Funder and derived-key funding flow

1. The funder key (`KRUXA_SOLANA_FUNDER_KEY`) pays for one SystemProgram transfer into G (the F0 child key, derived offline from the MPC root key, the core account as predecessor and path `kruxa:genesis:<launch>`). G has no private key anywhere: only `v1.signer` can sign for it, and only for messages whose sha256 the core registered.
2. tx1 and tx2 are signed by G through the core gate (`register_f0_message`, then `sign_genesis`) and sent by the relayer. Each gets its own fresh blockhash.
3. The funder never signs a genesis transaction. Its only on-chain act is the funding transfer.

## 5. What the verifier checks

`scripts/verify_solana.py` (checks C3 to C21, C27, and the NEAR-view checks): mint derivation and no key, spec hash, mint owner Tokenkeg and 82 bytes, both authorities None, supply equals the bucket sum, metadata immutable and equal to the spec, reserve and vault balances, distributor fields (root, max claim, nodes, timestamps, clawback receiver, admin is the incinerator), Squads (2-of-N, no config authority, time lock equals the charter and, with `--production`, at least 172,800 s), G holds no tokens and only the ceremony in its history and at most dust, on-chain tx bytes equal `compile(spec, blockhash, price)`, program allowlist, last token instruction is SetAuthority, merkle proofs.

Added here (C18 for records with `cluster == "mainnet-beta"`): the RPC's genesis hash is mainnet-beta, the spec chain is `solana-mainnet` with the mainnet hash, and the distributor is the real Jito id (a patched copy is a mismatch). Run with `--production` and a second RPC for a real record. The verifier does not check the program ELF hashes; the relayer does before sending.

## 6. Hard-coded devnet and localnet assumptions (inventory)

| Where | Assumption | Status |
|---|---|---|
| `relayer/src/cluster.ts` | cluster union and hash | now `devnet`, `local`, `mainnet-beta`; devnet and local also refuse a mainnet RPC |
| `relayer/src/ceremony.ts` | spec cluster hash check was devnet-only; cost table; Jito preflight told you to patch a copy | spec chain and hash checked per cluster; mainnet cost row added; mainnet requires the real Jito id and pinned binaries |
| `relayer/src/core.ts` | `StandaloneCore` spec says devnet | unchanged, rehearsal only (the mainnet CLI cannot use it) |
| `relayer/src/f0.ts`, `near.ts`, `f0-key.ts`, `realcore.ts` | testnet account, `v1.signer-prod.testnet`, `.testnet` core | mainnet variants added (`contractBackend(..., "mainnet")`, `mainnetAccount`); `f0-key.ts` still testnet only (use `scripts/mainnet/f0-key-mainnet.ts`) |
| `relayer/src/genesis-cli.ts` | funder file `relayer-devnet.json`, airdrop funder, rehearsal metadata URI, claim test | mainnet branch is a separate module with its own funder, URI and no claim test |
| `relayer/src/watcher-cli.ts` | `.testnet` core, `NEAR_TESTNET_RPC` | mainnet observe-only mode behind its own env; never sends |
| `relayer/src/launch-core2.ts` | testnet launch driver | untouched, testnet only |
| `tools/squads/vault.ts` | cluster parser accepts devnet and local only | untouched on purpose: the mainnet vault is made by `scripts/mainnet/create-squads-vault.mjs` |
| `scripts/genesis-devnet-setup.sh` | patched Jito copy | devnet only; the wrapper `genesis-devnet.sh` now refuses `mainnet-beta` |
| `scripts/genesis-local.sh` | dumped Metaplex and Squads from devnet | now dumps all three from mainnet-beta (`KRUXA_PROGRAM_SOURCE=devnet` to go back) |
| `scripts/verify.sh` | env var named `SOL_DEVNET_RPC`, default devnet | `scripts/mainnet/verify-mainnet.sh` already points it at mainnet |
| `scripts/gate-g2.sh` G2-08 | "zero mainnet-beta in relayer/src" | now: only in the guarded files (allowlist in the script) and the confirm guard present in `cluster.ts` |
| `scripts/mainnet/deploy-core.mjs` | core profile `ladder` | now `mainnet` (section 0) |
| `contracts/core/src/genesis.rs` | `ladder` and any non-`mainnet` profile commit a devnet spec | by design; avoided by using profile `mainnet` |

## 7. Rehearsal against the real program bytes

Run with `scripts/genesis-local.sh` (a local `solana-test-validator` preloaded with the REAL Jito distributor at its real id, the REAL Metaplex Token Metadata and the REAL Squads v4, all dumped read-only from mainnet-beta) and `scripts/genesis-verify-local.sh F0`:

- Full F0 ceremony through the relayer (sandbox backend, see below): create mint, metadata, reserve ATA, `new_distributor`, `set_admin` to the incinerator, mint to the vault and the reserve, seal the mint. Real `new_claim` by a holder succeeded against the real Jito binary and the merkle root matched.
- `verify_solana.py`: 17 checks PASS, 0 mismatches, `--tamper-all` detected all 12 tampered fields, evidence replay and the negative tests behaved.
- The new mainnet confirmation gate was rehearsed in a second local run with the final code (`--rehearse-gate`; verifier 16 checks PASS, 0 mismatches, claim ok, distributor admin NULL): the pre-commit plan, the exact pre-send plan (mint, metadata, reserve ATA, distributor, vault ATA, spec hash), the typed `MINT <code>` flow, and G ending at exactly the 890,880 lamport dust.
- On mainnet itself, read-only: `assertMainnetPrograms` (pinned hashes, immutability, executables) passed against live mainnet-beta, and tx1 of `compile()` was simulated by mainnet with `err: null` at 52,023 to 56,740 CU.

What was NOT run, and why:

- **No NEAR call of any kind.** The NEAR core, `register_f0_message`, `sign_genesis` and `confirm_genesis` on mainnet were not exercised (forbidden here), and no testnet transaction was sent either (the brief said not to). The F0 signer used locally is the sandbox stand-in key; the real signing path has only unit tests with a faked NEAR account (`f0.test.ts`, `ceremony-mainnet.test.ts`).
- **tx2 was not simulated on mainnet**: it needs tx1's state (the mint). It ran for real only on the local validator, whose Jito binary is byte-identical to mainnet's.
- The local validator has the OLD rent (6,960 per byte) and no Metaplex fee configuration, so the local cost row differs from mainnet by about 1.97M lamports. Mainnet cost is from simulation and live rent, not from the local run.
- Squads vault creation on mainnet (`create-squads-vault.mjs`) and the 48 h lock were not exercised; the CLI only reads the vault and refuses a lock under 172,800 s or a threshold under 2.
- No mainnet run of `genesis-cli --cluster mainnet-beta` in dry-run (it needs a mainnet NEAR key and a core account that do not exist yet).

## 8. How the guards work

`relayer/src/genesis-cli.ts --cluster mainnet-beta` calls `mainnetGenesis` (`genesis-mainnet.ts`). A live run needs all of:

1. `KRUXA_SOLANA_MAINNET_CONFIRMED=I_CONFIRM_DAMI_RUNS_THIS` on the command line (also needed for the dry run; `assertCluster` refuses without it, and every call re-checks).
2. The RPC's `getGenesisHash` equals `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`, checked at the start and before each transaction. devnet and local refuse a mainnet RPC.
3. `KRUXA_SOLANA_DRY_RUN=0` set explicitly. Unset or `1` is a dry run; any other value is refused.
4. `KRUXA_SOLANA_SPEND_CAP_SOL=<decimal>` (above 0, at most 0.5). The funding amount plus its 5,000 lamport fee must not exceed it.
5. A typed confirmation in an interactive terminal (stdin must be a TTY): the plan is printed and the owner types `MINT <8 hex>`, a code derived from the plan text. It is asked twice: before `commit_genesis` (one-shot on NEAR; derived mint, G, funder, upper-bound cost, programs) and before G is funded (exact: spec hash, metadata, reserve Squads multisig and vault, reserve ATA, distributor, vault ATA, lamports).

Other refusals on the mainnet path: F1 (F0 only), a `.testnet` core, no `--record`, rehearsal flags, `JITO_PROGRAM` not the real id, `F0_BACKEND` set, a non-https or `.example` metadata URI, a spec that is not `solana-mainnet` with the mainnet hash, programs that are not the pinned immutable binaries, rent that no longer reproduces the calibrated cost, a reserve Squads multisig under 2 signers or under a 48 h lock, a key file inside the repo or readable by others, a NEAR RPC that does not report chain_id `mainnet`.

The watcher (`watcher-cli.ts`) accepts `WATCHER_CLUSTER=mainnet-beta` only with `KRUXA_WATCHER_SOLANA_MAINNET=I_CONFIRM_WATCHER_OBSERVES_ONLY`, never accepts `--send` or `WATCHER_SEND=1` there, and its ceremony port throws on mainnet. It observes and alerts; the owner runs the CLI.

Dry run, then live (the owner types these, per C-01; both lines are one command each):

```
KRUXA_SOLANA_MAINNET_CONFIRMED=I_CONFIRM_DAMI_RUNS_THIS KRUXA_KEY_FILE=... KRUXA_SOLANA_FUNDER_KEY=... KRUXA_METADATA_URI=https://... SOL_MAINNET_RPC=... \
  npx --prefix relayer tsx relayer/src/genesis-cli.ts --launch 1 --mode F0 --cluster mainnet-beta --core <mainnet core> --record genesis-records/genesis-1.json
# live: add KRUXA_SOLANA_DRY_RUN=0 KRUXA_SOLANA_SPEND_CAP_SOL=0.04 to the same command line
```

A dry run still loads the keys (to derive G) and makes read-only NEAR and Solana calls; it sends nothing and stops at the first plan.

## 9. Resume and abort behaviour on mainnet

- Crash after G is funded and before tx1: re-run; the ceremony funds only `need - have`.
- tx1 landed, tx2 failed (for example error 6016 from a slow signer): the mint exists with G as mint authority. Re-run: it resumes, skips `commit_genesis`, recompiles tx2 with a fresh clock, and G needs no new funds if its balance is enough.
- Sealed mint already on chain: the adopt path checks it against the spec and only confirms on NEAR.
- A stranded unsealed mint with the F0 key is recoverable (G is re-derivable). That is the reason the mainnet path is F0 only: an F1 per-launch key lives in memory and a crash strands the mint.

## 10. Risks the owner must accept, and blockers

1. **Core profile (section 0).** Blocker if the core was already initialised as `ladder`.
2. **Irreversible.** Once tx2 lands, the mint is sealed and the supply is fixed. No admin exists. Any mistake in the committed spec (supply, buckets, merkle root, metadata URI, Squads multisig) is permanent. `confirm_genesis` on NEAR can still fail after the Solana mint exists; then the mint is real but unrecorded, and the adopt path is the recovery.
3. **The NEAR F0 path is untested on mainnet** and the signer's mainnet latency is unknown (300 s budget, section 3). A stuck `sign_genesis` leaves G funded and nothing minted (cost 0.021 SOL stranded in a key only the core can use).
4. **Programs are immutable and unaudited by us.** A bug in the Jito distributor or Metaplex cannot be patched. The 10,000,000 lamport Metaplex fee is paid for nothing if tx1 later fails.
5. **Cost calibration is exact and F0 cannot sweep.** Guarded by the live rent check, which refuses rather than adapts. If it refuses on the day, the table in `ceremony.ts` must be re-measured (simulate tx1, recompute tx2 from rent).
6. **Public RPC.** The default public mainnet RPC rate limits (429 seen). A dropped send after funding means a manual resume. Use a paid RPC.
7. **The reserve Squads vault must already exist** on mainnet with at least 2 signers and a 48 h lock; it is the owner of the reserve ATA and the clawback receiver. Three keys in three extension wallets is single-party control (R-56, disclosed).
8. **Claim UX.** Holders claim against the Jito distributor with a merkle proof after `start + 60 s`. `claim.ts` is a one-holder test tool, not a user path; a real claim page or a documented Jito claim flow is needed, and the clawback fires at `clawbackDays` after start.
9. **Not done here:** F1 on mainnet, LP mirror to Solana (compiler rejects it), Meteora or any pool (DN-14 keeps the LP seed on the NEAR pool), the real hosted metadata JSON, and any NEAR-side mainnet run.
