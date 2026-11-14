# submission/

The one-shot NEAR HACKATHON submission package. Templates here hold `{{PLACEHOLDER}}` values that change late (core hash, account names, judge-run numbers, git head, URLs). `scripts/fill-submission.sh` fills them from the repo's own records and refuses to run if anything is left unresolved. It never touches the root `README.md`.

## Files

| File | What it is | Reader |
|---|---|---|
| `FORM-PAYLOAD.md` | Every form field, paste-ready, with a proof column; description (20 to 2,000 characters) and the GREEN tracks array | the owner, at submit time |
| `proof.md` | Two-minute proof sheet: commands, expected lines checked against `evidence/`, hashes, limits | a judge or an AI judge |
| `links.md` | Link list; owner-created URLs are placeholders | the owner, the checklist before submit |
| `xpost-material.md` | Fact sheet for the X post: 15 SAFE sentences with proof paths, a Must NOT be claimed table, brief constraints. Not a post | the owner, who writes the post |
| `video-script.md` | 90 second script matched to the seven `make tour` scenes, shot list, recording steps | the owner, who records or approves the video |
| `values.env` | The values only people can fill (accounts, URLs, payout, team, preferred track, tag) | the coordinator and the owner |
| `track-claims.json`, `GENESIS-ROUND-GATES.md` | Existing: GREEN tracks written by `scripts/claimed-tracks.sh --json`; the Genesis Round gate state | |
| `../evidence/wire.md` | Wire sheet: each integration labelled TESTNET, MAINNET-READ-ONLY or MOCK, with its evidence path | judges and the owner |

`ORGANIZER-FEEDBACK.md` was not written: the brief (`/Users/MAC/.claude/skills/hackathon-briefs/near.md`) does not ask the submission for it. The plan lists it as optional (PLAN task 9.3, OUTSTANDING item DC10); build it from `rehearsal/LOG.md` and `rehearsal/BLOCKED.md` if the owner wants to send one.

## Fill order

1. Finish the late work: new core wasm, `artifacts/SHA256SUMS` updated (market and launcher rows too), `make judge-fast` and `make judge` re-run so `evidence/judge-fast-run.txt` and `evidence/judge-run.txt` hold the new numbers, `scripts/claimed-tracks.sh --json` rewrites `submission/track-claims.json`, refreshed testnet records for the final core in `evidence/` (the expected lines in `proof.md` block 8 and the `CODE` line must exist there).
2. Fill `submission/values.env`: `CORE_ACCOUNT`, `MARKET_ACCOUNT`, `LAUNCHER_ACCOUNT` (coordinator); `REPO_URL`, `X_POST_URL`, `VIDEO_URL`, `PAYOUT_ACCOUNT`, `TEAM_LEAD`, `TEAM_SIZE`, `PREFERRED_TRACK`, `RELEASE_TAG` (owner). Do not write `TEAM_EMAIL` into the file, the repo goes public; pass it in the environment.
3. Run the filler:

   ```bash
   TEAM_EMAIL=lead@example.com ./scripts/fill-submission.sh
   ```

   Expected last lines: `FILLED 6 files into ...`, then the description character count, then one summary line. Any `REFUSED:` line names the file and the cause; fix it and run again. Nothing is written on a refusal.
4. Read the filled files in `../kruxa-submission-filled/` (outside the repo by design, the filled form holds the lead's email). To make the five public ones real in the repo (not `FORM-PAYLOAD.md`), run with `--in-place` and review the diff before the coordinator commits.
5. Owner checks every link in `links.md` while logged out, writes the X post from `xpost-material.md`, records or approves the video from `video-script.md`, then submits from the filled `FORM-PAYLOAD.md`.

## Placeholders and where they come from

| Placeholder | Source |
|---|---|
| `{{GIT_HEAD}}`, `{{GIT_HEAD_SHORT}}` | `git rev-parse HEAD` |
| `{{CORE_SHA256}}`, `{{MARKET_SHA256}}`, `{{LAUNCHER_SHA256}}` and their `_SHORT` forms | `artifacts/SHA256SUMS`, each re-checked against the real file |
| `{{CORE_BYTES}}` | size of `artifacts/kruxa_core.wasm` |
| `{{CORE_BUILD_COMMIT_SHORT}}` | `artifacts/BUILD-KIND` |
| `{{JUDGE_STEPS}}`, `{{JUDGE_WALL_S}}`, `{{JUDGE_GIT_SHORT}}`, `{{JUDGE_LOCAL_CORE_SHA256_SHORT}}` | `evidence/judge-run.txt` (header, summary line, the `sha256 kruxa_core.wasm` key line) |
| `{{FAST_STEPS}}`, `{{FAST_WALL_S}}` | `evidence/judge-fast-run.txt` last line |
| `{{CORE_EXPLORER_URL}}` | built from `CORE_ACCOUNT` |
| `{{CORE_ACCOUNT}}`, `{{MARKET_ACCOUNT}}`, `{{LAUNCHER_ACCOUNT}}`, `{{REPO_URL}}`, `{{X_POST_URL}}`, `{{VIDEO_URL}}`, `{{PAYOUT_ACCOUNT}}`, `{{TEAM_LEAD}}`, `{{TEAM_EMAIL}}`, `{{TEAM_SIZE}}`, `{{PREFERRED_TRACK}}`, `{{RELEASE_TAG}}` | `submission/values.env` or the environment |

## What the filler checks besides placeholders

Hash equals file; judge run GREEN; claimed tracks equal the GREEN rows of the judge run and the form's tracks array; preferred track is claimed; no RED track in the form; description length; no em or en dash; every backticked repo path exists; every `expected` line is found verbatim under `evidence/` (skip with `--no-evidence-check`).

## Known gaps to decide before submit

- `README.md` says `make judge` takes about 40 minutes; the recorded full run took the wall time in `evidence/judge-run.txt` (3,127 s at the time of writing). This package quotes the recorded number. The README is not edited here.
- The sheet's live testnet check (`proof.md` block 8) needs a committed record for the final core account; only the earlier core7 records exist today.
