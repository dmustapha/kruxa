# Video script: 90 seconds

Screen recording of a terminal plus plain voiceover. It follows the seven scenes of `make tour` (`scripts/tour.sh`, recorded in `evidence/judge-run.txt` step O1 as `TOUR 1/7` to `TOUR 7/7` and `TOUR GREEN`), then one live read of the testnet core, then the limits. The owner records or approves it before it is posted (`submission/xpost-material.md`). No scene shows anything that did not run; every line on screen exists in `evidence/judge-run.txt` or in the files named per scene.

Voice rules: plain words, short sentences, no hype words, no "revolutionary", no "trustless", no "secure". Say "testnet" and "devnet" out loud.

## Shot list and timing

| Time | Shot (screen) | Voiceover | Source of what is on screen |
|---|---|---|---|
| 0:00 to 0:07 | `README.md` top, the first paragraph | "Kruxa is a token launch you can walk away from. Built for NEAR HACKATHON." | `README.md` lines 1 to 5 |
| 0:07 to 0:15 | Run `make tour`. Hold on `TOUR 1/7 hostile preset refused: R_ALLOC R_WINDOW` | "A creator sets a hostile preset. The rule check refuses it and names two rule codes." | `scripts/tour.sh` scene 1; `evidence/judge-run.txt` |
| 0:15 to 0:22 | `TOUR 2/7 standard preset accepted: no rule violated` | "A standard preset passes. The terms are fixed when the launch opens." | scene 2; `README.md` "What it is" (Trial) |
| 0:22 to 0:35 | `TOUR 3/7` and its plus line | "After the commit window, anyone settles. The rule is exact. Exactly at the soft cap is a pass. One micro-USDC below is a fail, and everyone is refunded." | scene 3; `CLAIMS.md` C-01, C-02 |
| 0:35 to 0:44 | `TOUR 4/7 oversubscribed 100 USDC buyer spends 40, refunded 60` | "If a launch is oversubscribed, the excess goes back pro rata. A 100 dollar buyer spends 40 and gets 60 back." | scene 4; `CLAIMS.md` C-03 |
| 0:44 to 0:58 | `TOUR 5/7` replay `MATCH`, then the plus line `MISMATCH, exit 2` | "Anyone can replay a recorded launch and get the same book hash. Change one micro-USDC in the record and the verifier prints MISMATCH and exits with code 2." | scene 5; `evidence/judge-run.txt` line `MISMATCH log (event 30: ...)` |
| 0:58 to 1:06 | `TOUR 6/7` market lines | "After a pass, a market pool splits its fees five ways. In a 60-day simulation the creator never takes more than half." | scene 6; lines `SLICES OK`, `BOUND OK` |
| 1:06 to 1:13 | `TOUR 7/7` swarm, then `TOUR GREEN` | "Sixteen scripted agents, honest and hostile, run 24 rounds. The invariants hold in every round. They are scripts, not language models." | scene 7; `INVARIANTS HELD in 24 of 24 rounds` |
| 1:13 to 1:24 | New terminal: the testnet read (command below). Hold on the `NOTE:` line and the `CODE: ... MATCH` line | "On NEAR testnet, the core's code hash equals the reproducible build in this repo. This is play money. The note says the owner key can still redeploy it, and we keep that line on screen." | `scripts/verify.sh` `near-ops`; `evidence/verify/core7-launch1...` shows the same two line shapes |
| 1:24 to 1:30 | Card: three lines, then the repo URL | "Nothing is on mainnet. No independent audit. Testnet and devnet only. Kruxa, built for NEAR HACKATHON." | `README.md` "Limits, stated plainly"; repo URL is `{{REPO_URL}}` |

Seconds: 7 + 8 + 7 + 13 + 9 + 14 + 8 + 7 + 11 + 6 = 90.

Voiceover word count is about 180, which fits 90 seconds at a calm pace.

## Commands to run on screen

```bash
make tour
```

```bash
./scripts/verify.sh near-ops --rpc https://test.rpc.fastnear.com --contract {{CORE_ACCOUNT}}
```

The second command is a read-only view of the testnet core. It prints the key line, the `NOTE:` line and the `CODE:` line. Its expected last line is in `submission/proof.md` block 8.

Optional cut-in, if the video runs short (not in the 90 s count): the recorded devnet genesis replay.

```bash
./scripts/verify.sh --evidence evidence/genesis/core2-f0-devnet-launch6-evidence.json
```

It prints `RECORDED, not live` first. Show that line; never present it as live.

## What to record, step by step

1. Warm the build once so the tour runs in seconds: `make tour`, then clear. The tour calls `cargo run` several times and is cold-slow on a fresh machine (`scripts/tour.sh` header).
2. Terminal: dark theme, font size at least 18, 100 columns, no personal paths or accounts in the prompt. The repo root is the working directory.
3. Record `make tour` once as one take. In the edit, hold each `TOUR n/7` line for its time slot above. The `+` lines are part of their scene.
4. Record the testnet read as a second take (network needed). If the RPC returns 429 or times out, wait and retry; do not use an older recording and do not label an offline replay as live.
5. Show the label `NEAR TESTNET, play money` as a small corner tag on the testnet shot only. Show `OFFLINE, no keys` on the tour shots.
6. Closing card text: `Nothing is on mainnet` / `No independent audit` / `Testnet and devnet only`, then the repo URL, then `Built for NEAR HACKATHON`.
7. Check the final cut for: no key material, no wallet popups, no browser tabs with accounts, no em dashes or hype words in captions.
8. Export under 90 seconds, then upload where the X post will link it. The URL goes into `submission/values.env` as `VIDEO_URL`.

## Not in this video (on purpose)

The web app, Phantom signing, the Intents live path, anything on mainnet, the Instant launch mode, and the Genesis Round. The repo does not evidence them to a standard that survives a judge re-running them (`submission/xpost-material.md` "Must NOT be claimed").
