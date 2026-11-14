# Submission form payload (paste-ready)

The NEAR HACKATHON form is one-shot and cannot be edited after sending (brief section 2, `/Users/MAC/.claude/skills/hackathon-briefs/near.md`). Run `scripts/fill-submission.sh` first. Paste only from the filled `FORM-PAYLOAD.md` in its output directory (default `../kruxa-submission-filled/`, outside the repo because it holds the lead's email), never from this template. Fields marked OWNER are the owner's to fill; nothing here is submitted by an agent.

Form fields per the brief: project name, description (20 to 2,000 characters), team lead and email and size, preferred track, NEAR account for payout, link to the public repo, link to the public demo post on X (video or screenshots, must say it was built for NEAR HACKATHON).

## Fields

| # | Form field | Paste this | Proof or source |
|---|---|---|---|
| 1 | Project name | `Kruxa` | `README.md` line 1 |
| 2 | Description (20 to 2,000 characters) | the block under "Description" below | each sentence is traced in the table under it |
| 3 | Team lead | `{{TEAM_LEAD}}` (OWNER) | `SUBMISSION_STATUS.md` section 3 item 11 (owner submits) |
| 4 | Team lead email | `{{TEAM_EMAIL}}` (OWNER) | owner only; not in the repo |
| 5 | Team size | `{{TEAM_SIZE}}` (OWNER) | owner only; not in the repo |
| 6 | Preferred track (pick ONE) | `{{PREFERRED_TRACK}}` (OWNER chooses from the list in field 7) | brief section 4; `submission/track-claims.json` |
| 7 | Tracks Kruxa may list (GREEN only) | JSON array below | `submission/track-claims.json`, `evidence/judge-run.txt` track table |
| 8 | NEAR account for payout | `{{PAYOUT_ACCOUNT}}` (OWNER, flagged: only the owner confirms this account and holds its keys) | brief section 6; `SUBMISSION_STATUS.md` section 3 item 6 (payout address is the owner's ruling GR-17) |
| 9 | Public repo URL | `{{REPO_URL}}` | repo must be public and tagged `{{RELEASE_TAG}}`; owner makes it public (`SUBMISSION_STATUS.md` section 3 item 11) |
| 10 | Public demo post on X | `{{X_POST_URL}}` | owner posts; the post must say it was built for NEAR HACKATHON (brief section 2) |
| 11 | Demo video (if the form asks) | `{{VIDEO_URL}}` | `submission/video-script.md` |

## Tracks array (field 7)

Only the GREEN rows of the last `make judge` table. Exactly the `claimed` list of `submission/track-claims.json`; `scripts/fill-submission.sh` refuses to run if this array and that file disagree, or if `evidence/judge-run.txt` shows a different GREEN set.

```json
["Memecoins With Mechanics", "AI Security & Defense", "AI Swarms", "Open Innovation", "Investment Thesis"]
```

Not claimed, do not select: the two RED rows of `evidence/judge-run.txt` (see `submission/track-claims.json`, key `not_claimed_red`).

## Description

Characters are counted by `scripts/fill-submission.sh` after substitution and the script refuses a count outside 20 to 2,000. Plain labelled paragraphs, no headings.

<!-- DESCRIPTION-START -->
Kruxa is a token launchpad on NEAR where a launch is a refundable trial.

How it works: buyers commit USDC and can Walk (take their principal back, no contract fee) until the walk deadline. After the commit window anyone calls settle. A fixed rule decides. PASS needs total committed at or above the soft cap and enough distinct funders. One micro-USDC short is a FAIL and everyone is refunded. After a PASS, oversubscribed excess is refunded pro rata at one uniform price, the creator's proceeds stream at a capped rate, and a market pool trades the token. Anyone can recompute a verdict with no keys (scripts/verify.sh).

What uses NEAR: smart contracts (trial core, market, instant launcher), NEAR Intents (cross-chain commits through mt_on_transfer; the sandbox loads the real intents.near wasm), Chain Signatures (signs the Solana devnet mint transactions only if they match a registered hash), the NEAR token factory (testnet probe), and NEAR testnet (core account {{CORE_ACCOUNT}}, reproducible build sha256 {{CORE_SHA256_SHORT}}).

Try it with no keys and no funds: make judge-fast ({{FAST_STEPS}} steps green in {{FAST_WALL_S}} s on the recorded run) or make judge ({{JUDGE_STEPS}} steps green in {{JUDGE_WALL_S}} s on the recorded run, commit {{JUDGE_GIT_SHORT}}). The README lists each command with its expected output.

Limits, stated plainly: nothing is on mainnet. No independent audit. The judge path is a sandbox plus recorded data. The owner holds an upgrade key on the testnet core. Solana ran on devnet only. The attackers and swarm agents are scripted tests, not language models. Sybil wallets are not defended against.

Tracks: Memecoins With Mechanics, AI Security & Defense, AI Swarms, Investment Thesis, Open Innovation.
<!-- DESCRIPTION-END -->

### Where each description sentence comes from

| Sentence | Proof |
|---|---|
| Refundable trial, Walk, no contract fee until the walk deadline | `README.md` "What it is" (Commit and Walk); `CLAIMS.md` C-01 to C-03 |
| PASS rule, one micro-USDC short is FAIL, everyone refunded | `evidence/judge-run.txt` lines `outcome=PASS` and `outcome=FAIL(reasons=1)`; `CLAIMS.md` C-01, C-02 |
| Oversubscribed excess refunded pro rata, capped creator stream, market pool | `README.md` "What it is"; `CLAIMS.md` C-03, C-06; `evidence/judge-run.txt` line `SLICES OK` |
| Verdict recomputed with no keys | `scripts/verify.sh` header; `evidence/judge-run.txt` T1 to T5 |
| Intents via `mt_on_transfer`, real `intents.near` wasm in the sandbox | `README.md` "What uses NEAR"; `tests/tests/real_intents.rs`; `SUBMISSION_STATUS.md` section 2 (S3 row) |
| Chain Signatures sign Solana devnet transactions only if they match a registered hash | `README.md` "What uses NEAR"; `LIMITATIONS.md` limit 6; `evidence/genesis/core7-f0-devnet-launch6.json` |
| Token factory is a testnet probe | `evidence/factory-probe.txt`; `README.md` "What uses NEAR" |
| Core account and reproducible build hash | `artifacts/SHA256SUMS`; `artifacts/BUILD-KIND`; `evidence/testnet-core7/README.md` (account and hash filled from `submission/values.env` and `artifacts/SHA256SUMS`) |
| Fast and full judge numbers | `evidence/judge-fast-run.txt` last line; `evidence/judge-run.txt` last summary line |
| Limits sentence | `HONESTY.md` items 1, 7, 10; `LIMITATIONS.md` limits 1, 7, 8; `README.md` "Limits, stated plainly" |
| Tracks sentence | `submission/track-claims.json` |

## Before pressing submit

1. `scripts/fill-submission.sh` exited 0 and printed the description character count.
2. The repo URL opens while logged out and shows the tag `{{RELEASE_TAG}}`.
3. The X post URL opens while logged out, plays the video, and says it was built for NEAR HACKATHON.
4. The payout account `{{PAYOUT_ACCOUNT}}` is the owner's own account.
5. The tracks array above is the same set as the last `make judge` table (`make claimed-tracks`).
6. No sentence claims anything listed under "Must NOT be claimed" in `submission/xpost-material.md`.
