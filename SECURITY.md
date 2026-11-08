# Security

## Threat matrix

| Threat | Enforcement | File |
|---|---|---|
| Fake token credited as USDC | `ft_on_transfer` returns the amount unless `predecessor == cfg.usdc`; `mt_on_transfer` requires `predecessor == intents.near`, one token equal to the USDC token id, `previous_owner_ids[0] == sender_id` | `contracts/core/src/intake.rs` |
| Direct call to a callback | `#[private]` on `on_token_created`, `on_token_verified`, `on_payout`, `on_contribute_intents` | `lifecycle.rs`, `payout.rs`, `s4.rs` |
| Reentrancy / double pay | checks, then effects, then promise; debit before outbound; callback re-credits only its own op; second `claim_refund` finds `due == 0` and returns false | `payout.rs` |
| Forged attribution of a Solana buyer | S3: the Verifier authenticates the signer and our `resolve_holder` requires `deliver == sol:<same key>`; S4: strict payload struct, `signer_id == hex(public_key)`, memo key equals signer | `intake.rs`, `s4.rs` |
| Walk replay or forgery | monotone per-key nonce, deadline, `env::ed25519_verify` over a fixed preimage that names the contract, launch, holder, nonce and deadline | `intake.rs::walk_signed` |
| Creator self-funds a PASS | creator and stream recipient cannot commit (R_SELF_BUY); cost floor: launch fee plus locked LP; **sybil wallets are NOT defended** | `intake.rs::check_commit` |
| Verdict manipulation by the caller | `settle` reads only stored state; no caller-dependent input, no promise | `lifecycle.rs::settle` |
| Last-second flip | commits close at `commit_end`; the walk tail lets stayers react; margin shown in the app | `kruxa-logic::phase_at`, `app/app/launch/[id]/page.tsx` |
| Oversized or malicious commit message | 512-byte limit, `deny_unknown_fields`, typed parse before any state change | `intake.rs::parse_msg` |
| Hostile re-parameterisation after commits | Charter is written once and hashed; rules are a snapshot | `lifecycle.rs::create_trial` |
| Rounding drain | charged amounts round up, paid amounts round down, residue to LP; proptest of conservation | `kruxa-math`, `kruxa-logic::settle` |
| Pause trapping exits | exits require only "not FROZEN"; FROZEN auto-expires in 7 days; unpause is owner-only | `lib.rs::pause_level`, `admin.rs` |
| Instant cap inflation | raising a cap is queued 7 days and public; lowering is instant | `admin.rs` |
| Brand symbol squatting | `KRUXA` and 8 others are reserved to the owner | `kruxa-logic::rules::check_text` |
| Mainnet by accident | `lib/config.ts` throws on mainnet without the confirmation token; `testnet-deploy.sh` refuses non-testnet | `app/lib/config.ts`, `scripts/testnet-deploy.sh` |

## Not defended against

1. **Sybil wallets.** Nothing here proves that committed money comes from distinct people; `min_funders` counts accounts. No sybil-resistance claim is made.
2. **Upgrade authority.** Wave 1 has no upgrade path and the deployer holds a full-access key on testnet (phase P0, disclosed). The multisig + 7-day timelock plan (S1-A 10.4) is Wave 2+; until then a key holder can replace the code.
3. **The Intents Verifier and its DAO.** Money held in `intents.near` is exposed to its force-withdraw and lock powers (S1-B X23); time in Intents is minimised by `consolidate`, not eliminated.
4. **The launch-token factory.** `token.primitives` instances adopt code from a global contract whose owner holds one full-access key. The platform cannot detect a code swap on-chain; detection is off-chain (hash comparison in `verify`, Wave 2). Own-FT-by-hash is the mitigation and is not approved.
5. **No independent review.** No audit has covered this code. The Genesis Round, if run, runs with that gap disclosed.
6. **Compile and VM compatibility on mainnet.** The wasm loaded in the protocol-88 sandbox; mainnet also reports protocol 88 [VERIFIED 2026-11-08], but acceptance on the real network is untested until the testnet deploy.
7. **Wave 1 omissions that are exposures, not features:** the async solvency anchor, burn of a failed launch's token, creator-allocation vesting, and in-claim token registration (Section 5.6).
8. **Frontend runtime.** The app was built, not exercised in a browser or against a live wallet.
9. **Block-timestamp skew** shifts a boundary by seconds; windows are 24 hours or more on the ladder profile, 90 s / 30 s on the labelled demo profile.
10. **Front-end and RPC trust** for anyone who does not run `verify` themselves.


