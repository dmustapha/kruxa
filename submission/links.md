# Link list

URLs the owner creates are placeholders until `submission/values.env` is filled. `scripts/fill-submission.sh` refuses to run while any is empty. Before the one-shot submit, open every link below while logged out.

## Owner-created (placeholders)

| What | URL | Who creates it | Check before submit |
|---|---|---|---|
| Public repo | {{REPO_URL}} | owner (`SUBMISSION_STATUS.md` section 3 item 11) | opens logged out; shows tag `{{RELEASE_TAG}}`; head is `{{GIT_HEAD_SHORT}}` or a later documented commit |
| Demo post on X | {{X_POST_URL}} | owner writes and posts it | opens logged out; video plays; text says it was built for NEAR HACKATHON |
| Demo video file or host | {{VIDEO_URL}} | owner records or approves (`submission/video-script.md`) | plays without login |
| Payout account (not a link) | `{{PAYOUT_ACCOUNT}}` | owner | the owner's own NEAR account |

## Repo-internal (relative; `scripts/fill-submission.sh` checks that each path exists)

| What | Path |
|---|---|
| README (try-it steps, "do X, see Y") | `README.md` |
| Proof sheet | `submission/proof.md` |
| Form payload | `submission/FORM-PAYLOAD.md` |
| Wire sheet (each integration labelled TESTNET, MAINNET-READ-ONLY or MOCK) | `evidence/wire.md` |
| Full judge record | `evidence/judge-run.txt` |
| Fast judge record | `evidence/judge-fast-run.txt` |
| Track claims | `submission/track-claims.json` |
| Every disclosure | `HONESTY.md`, `LIMITATIONS.md`, `SECURITY.md` |
| Claims ledger | `CLAIMS.md` |
| Which wasm each evidence set belongs to | `evidence/HASH-NOTE.md` |

## Testnet accounts (play money)

| Role | Account | Explorer |
|---|---|---|
| Core | `{{CORE_ACCOUNT}}` | {{CORE_EXPLORER_URL}} |
| Market | `{{MARKET_ACCOUNT}}` | `https://testnet.nearblocks.io/address/{{MARKET_ACCOUNT}}` |
| Instant launcher | `{{LAUNCHER_ACCOUNT}}` | `https://testnet.nearblocks.io/address/{{LAUNCHER_ACCOUNT}}` |

The explorer URL pattern is the public testnet explorer's address page. It is not stored anywhere in the repo, so open each one once and confirm it loads.

## External (read-only references named in the repo)

| What | URL | Where the repo names it |
|---|---|---|
| NEAR testnet RPC used by the verifier | https://test.rpc.fastnear.com | `scripts/verify.sh`, `scripts/verify-claims.sh` |
| 1Click quote API (dry quote only, no funds) | https://1click.chaindefuser.com/v0/quote | `evidence/dryquote.txt`, `ARCHITECTURE.md` section 16 |
| Hackathon site and rules | nearhackathon.com (and its HACKATHON.md) | brief `/Users/MAC/.claude/skills/hackathon-briefs/near.md` section 1 |
