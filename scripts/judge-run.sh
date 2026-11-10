#!/usr/bin/env bash
# make judge: the whole judge path in one command. Sandbox only. No keys, no funds, no mainnet, no testnet.
#
# What it runs (each step is timed, logged to target/judge/<id>.log and judged GREEN or RED on exit code AND expected output):
#   build the wasm, pure tests, golden vectors, core / market / launcher suites in the near-workspaces sandbox,
#   the attack gallery, verify tamper checks (replayed records, never a live RPC), the swarm simulator, and `make tour`.
# Then it prints a per-track GREEN / RED table and writes it to target/judge/track-table.tsv (scripts/claimed-tracks.sh reads it).
#
# Network use, stated exactly:
#   N1  `cargo fetch` from crates.io and the read-only `view_code` of intents.near on a mainnet RPC (hash-pinned, no signature).
#   N2  compiling the test binaries; the near-sandbox build script downloads the NEAR sandbox binary on a cold machine.
#   Everything after N2 runs with CARGO_NET_OFFLINE=true. The dead-RPC check talks to 127.0.0.1:1 only.
#
# --fast: one smoke test file per sandbox suite and a check of the committed attack-gallery record instead of a re-run (about 10 minutes
#         on a cold machine). It never claims tracks: only the full run does. Exit 0 means the fast subset is green.
# --prebuilt: the no-toolchain-build judge path (J-1, Dockerfile.judge). Builds nothing and fetches nothing: it checks artifacts/SHA256SUMS,
#         runs the sandbox lifecycle on those exact wasm bytes, the golden vectors, the offline verify checks, the market demo and the swarm,
#         and is RED if the wall time reaches 300 s. Needs artifacts/ (scripts/build-artifacts.sh) and the mock wasm under target/near/
#         (the image builds them). Never claims tracks. With --record it writes evidence/judge-prebuilt-run.txt.
# Usage: scripts/judge-run.sh [--fast | --prebuilt] [--record]     --record also copies the summary to evidence/judge-run.txt
# Exit: 0 every step GREEN, 1 any step RED, 64 usage.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
OUT=$ROOT/target/judge
RECORD=0
FAST=0
PREBUILT=0
for a in "$@"; do case "$a" in
  --record) RECORD=1 ;;
  --fast) FAST=1 ;;
  --prebuilt) PREBUILT=1 ;;
  -h|--help) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "usage: $0 [--fast | --prebuilt] [--record]" >&2; exit 64 ;;
esac; done

# ---- scrub: no credential-shaped variable reaches any step ------------------------------------------------------------
scrubbed=0
for v in $(compgen -e); do
  case "$v" in
    NEAR_SANDBOX_BIN_PATH) ;;
    *SECRET*|*PRIVATE*|*MNEMONIC*|*PASSWORD*|*API_KEY*|*APIKEY*|*_TOKEN|*_KEY|*_KEYS|NEAR_*|KRUXA_*|SOL_*|SOLANA_*|AWS_*|GITHUB_*|GH_*|ANTHROPIC_*|OPENAI_*|*_RPC)
      unset "$v"; scrubbed=$((scrubbed + 1)) ;;
  esac
done
export KRUXA_JUDGE=1

rm -rf "$OUT"; mkdir -p "$OUT"
: >"$OUT/steps.tsv"
T_START=$(date +%s)
EXPECT=(); FORBID=()
head_sha=$(git rev-parse HEAD 2>/dev/null || echo unknown)
dirty=0; [ -n "$(git status --porcelain 2>/dev/null | grep -v '^?? ')" ] && dirty=1

echo "KRUXA JUDGE RUN  git ${head_sha:0:12}$([ $dirty = 1 ] && echo ' (tracked files modified)')  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "sandbox only; no keys, no funds, no mainnet or testnet transaction; $scrubbed credential-shaped variables scrubbed"
echo

# ---- step runner -------------------------------------------------------------------------------------------------------
# step <id> <wanted exit> <title> <cmd...>   EXPECT / FORBID (arrays) are substrings required in / banned from the output.
step() {
  local id=$1 want=$2 title=$3; shift 3
  local log=$OUT/$id.log t0 rc status=GREEN why="" e
  t0=$(date +%s)
  ( "$@" ) >"$log" 2>&1; rc=$?
  local secs=$(( $(date +%s) - t0 ))
  [ "$rc" -eq "$want" ] || { status=RED; why="exit $rc, wanted $want"; }
  for e in "${EXPECT[@]:-}"; do [ -z "$e" ] && continue; grep -qF -- "$e" "$log" || { status=RED; why="${why:+$why; }output lacks: $e"; }; done
  for e in "${FORBID[@]:-}"; do [ -z "$e" ] && continue; ! grep -qF -- "$e" "$log" || { status=RED; why="${why:+$why; }output has: $e"; }; done
  printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$status" "$secs" "$title" "$why" >>"$OUT/steps.tsv"
  printf '  %-3s %-5s %5ss  %s%s\n' "$id" "$status" "$secs" "$title" "${why:+   [$why; see target/judge/$id.log]}"
  EXPECT=(); FORBID=()
}
skip() { # <id> <title> <reason>
  printf '%s\tRED\t0\t%s\tnot run: %s\n' "$1" "$2" "$3" >>"$OUT/steps.tsv"
  printf '  %-3s %-5s %5ss  %s   [not run: %s]\n' "$1" RED 0 "$2" "$3"
}
is_green() { awk -F'\t' -v id="$1" '$1==id && $2=="GREEN" {f=1} END {exit !f}' "$OUT/steps.tsv"; }

# ---- the attack gallery rewrites tracked evidence; run it in place, keep the run, restore the committed files ---------------
run_gallery() {
  local keep=$OUT/gallery-run
  rm -rf "$keep"; mkdir -p "$keep/saved"
  cp -R evidence/attack-gallery "$keep/saved/evidence-attack-gallery"
  cp docs/ATTACK-GALLERY.md "$keep/saved/ATTACK-GALLERY.md" 2>/dev/null || true
  ./scripts/attack-gallery.sh --skip-build; local rc=$?
  cp evidence/attack-gallery/attack-gallery.json "$keep/attack-gallery.json" 2>/dev/null || true
  rm -rf evidence/attack-gallery; cp -R "$keep/saved/evidence-attack-gallery" evidence/attack-gallery
  [ -f "$keep/saved/ATTACK-GALLERY.md" ] && cp "$keep/saved/ATTACK-GALLERY.md" docs/ATTACK-GALLERY.md
  return $rc
}

# ---- --prebuilt: no build, no fetch; the shipped artifacts are what the sandbox runs -------------------------------------------
prebuilt_run() {
  export CARGO_NET_OFFLINE=true; echo "== STEPS (--prebuilt)"
  EXPECT=("kruxa_core.wasm: OK" "kruxa_market_contract.wasm: OK" "kruxa_instant_contract.wasm: OK"); FORBID=("FAILED")
  step A0 0 "artifacts/SHA256SUMS: every shipped wasm hashes to its recorded sha256" ./scripts/build-artifacts.sh --check
  if is_green A0; then
    EXPECT=("using artifacts/kruxa_core.wasm"); step A1 0 "the sandbox below runs the shipped artifact bytes (copied to target/near)" bash -c \
      'for n in kruxa_core kruxa_market_contract kruxa_instant_contract; do mkdir -p target/near/$n && cp artifacts/$n.wasm target/near/$n/$n.wasm && echo "using artifacts/$n.wasm"; done'
  else skip A1 "artifact bytes into the sandbox" "A0 red"; fi
  EXPECT=("outcome=PASS" "outcome=FAIL(reasons=1)" "spend=40000000 refund=60000000")
  step V1 0 "golden vectors: PASS at the soft cap, FAIL one micro-USDC below, oversubscription refund" ./scripts/verify.sh golden
  if is_green A1; then
    EXPECT=("JUDGE LIFECYCLE PASS"); FORBID=("FAILED")
    step L1 0 "narrated lifecycle on the real core wasm: create, commit, walk, settle PASS and FAIL, refunds, STREAM_CAP" \
      cargo test --locked --offline -q -p kruxa-tests --test judge_lifecycle -- --nocapture --test-threads=1
  else skip L1 "narrated lifecycle" "A1 red"; fi
  BOOK=$(cat fixtures/events/lifecycle.book_hash)
  EXPECT=("MATCH"); FORBID=("MISMATCH")
  step T1 0 "verify: recorded launch lifecycle replays to its recorded book hash" \
    cargo run -q --locked --offline -p kruxa-sim -- fold --events fixtures/events/lifecycle.jsonl --book-hash "$BOOK"
  EXPECT=("MISMATCH log"); step T2 2 "tamper: one micro-USDC changed in the record is detected, exit 2" \
    cargo run -q --locked --offline -p kruxa-sim -- fold --events fixtures/events/lifecycle.jsonl --book-hash "$BOOK" --tamper
  EXPECT=("RECORDED, not live" "PASS C7"); FORBID=("MISMATCH")
  step T3 0 "verify: recorded Solana devnet genesis re-checks clean" ./scripts/verify.sh --evidence evidence/genesis/core2-f0-devnet-launch6-evidence.json
  EXPECT=("MISMATCH"); step T4 2 "tamper-all: every recorded Solana input flipped, each run detected, exit 2" \
    ./scripts/verify.sh --evidence evidence/genesis/core2-f0-devnet-launch6-evidence.json --tamper-all
  EXPECT=(); FORBID=("MISMATCH"); step T5 4 "dead RPC exits 4 and never prints MISMATCH" \
    cargo run -q --locked --offline -p kruxa-sim -- verify --rpc http://127.0.0.1:1 --contract core.kruxa.testnet --launch 1
  EXPECT=("SLICES OK"); step M2 0 "market demo: buy and sell, five fee slices add up, custody unchanged" ./scripts/market-demo.sh
  EXPECT=("SWARM GREEN"); step W1 0 "swarm: invariants every round, recorded runs reproduce" ./scripts/swarm-run.sh
  local wall=$(( $(date +%s) - T_START ))
  if [ "$wall" -lt 300 ]; then printf 'Z1\tGREEN\t0\twall time %ss is under the 300 s budget\t\n' "$wall" >>"$OUT/steps.tsv"
  else printf 'Z1\tRED\t0\twall time\twall %ss reaches the 300 s budget\n' "$wall" >>"$OUT/steps.tsv"; fi
  local total red; total=$(wc -l <"$OUT/steps.tsv" | tr -d ' '); red=$(awk -F'\t' '$2!="GREEN"' "$OUT/steps.tsv" | wc -l | tr -d ' ')
  awk -F'\t' '$1=="Z1" {printf "  %-3s %-5s %5ss  %s%s\n", $1, $2, $3, $4, ($5 != "" ? "   [" $5 "]" : "")}' "$OUT/steps.tsv"
  echo; echo "PREBUILT: $((total - red)) of $total steps green, wall ${wall}s. No tracks claimed; the full run claims them."
  [ "$red" = 0 ] || awk -F'\t' '$2!="GREEN" {printf "  RED %s: %s %s\n", $1, $4, $5}' "$OUT/steps.tsv"
  if [ "$red" = 0 ]; then echo "JUDGE PREBUILT GREEN"; fi
  if [ "$RECORD" = 1 ]; then
    { echo "# Prebuilt judge run record. Written by scripts/judge-run.sh --prebuilt --record on commit ${head_sha}."
      awk -F'\t' '{printf "%-3s %-5s %5ss  %s%s\n", $1, $2, $3, $4, ($5 != "" ? "   [" $5 "]" : "")}' "$OUT/steps.tsv"
      echo "PREBUILT: $((total - red)) of $total steps green, wall ${wall}s."
      grep -h "^STEP\|JUDGE LIFECYCLE" "$OUT/L1.log" 2>/dev/null
    } >evidence/judge-prebuilt-run.txt
  fi
  [ "$red" = 0 ]
}
if [ "$PREBUILT" = 1 ]; then prebuilt_run; exit $?; fi

echo "== STEPS"
# P0 prerequisites -------------------------------------------------------------------------------------------------------
prereq() {
  local miss=0 c
  for c in cargo rustc cargo-near python3 jq curl base64 awk grep; do
    command -v "$c" >/dev/null 2>&1 || { echo "missing: $c"; miss=1; }
  done
  echo "toolchain: $(rustc --version 2>/dev/null) (rust-toolchain.toml pins 1.95.0)"
  echo "cargo-near $(cargo near --version 2>/dev/null | head -1)"
  return $miss
}
EXPECT=("toolchain: rustc 1.95.0"); step P0 0 "prerequisites: Rust 1.95.0, cargo-near, python3, jq, curl" prereq

if is_green P0; then
  # N1: the only deliberate network use ---------------------------------------------------------------------------------
  EXPECT=("intents.near wasm ok"); step N1 0 "network: crates.io fetch and the hash-pinned intents.near wasm" \
    bash -c 'cargo fetch --locked && ./scripts/fetch-intents-wasm.sh'
  # N2: compile every test binary (the NEAR sandbox binary is downloaded by a build script on a cold machine) --------------
  if is_green N1; then
    step N2 0 "compile all test binaries (sandbox binary download on a cold machine)" \
      cargo test --locked --no-run -p kruxa-tests -p kruxa-math -p kruxa-logic -p kruxa-sim -p kruxa-market -p kruxa-instant -p swarm-sim
  else skip N2 "compile all test binaries" "N1 red"; fi
else skip N1 "network: fetch" "P0 red"; skip N2 "compile all test binaries" "P0 red"; fi
export CARGO_NET_OFFLINE=true   # from here on cargo may not touch the network

# build ------------------------------------------------------------------------------------------------------------------
if is_green N2; then
  EXPECT=("kruxa_core.wasm" "kruxa_market_contract.wasm" "kruxa_instant_contract.wasm" "sha256 kruxa_core.wasm")
  step B1 0 "build core, market and launcher wasm with cargo-near, print their sha256" \
    bash -c './scripts/build.sh && ./scripts/market-build.sh && ./scripts/instant-build.sh && python3 -I scripts/wasm-sha256.py'
else skip B1 "build wasm" "N2 red"; fi

# pure tests and golden vectors (no chain, no sandbox) --------------------------------------------------------------------
if is_green N2; then
  EXPECT=("test result: ok"); FORBID=("FAILED")
  step U1 0 "pure unit and property tests (math, logic, sim, market, launcher, swarm)" \
    cargo test --locked --offline -q -p kruxa-math -p kruxa-logic -p kruxa-sim -p kruxa-market -p kruxa-instant -p swarm-sim
  EXPECT=("outcome=PASS" "outcome=FAIL(reasons=1)" "spend=40000000 refund=60000000")
  step V1 0 "golden vectors: PASS at the soft cap, FAIL one micro-USDC below, oversubscription refund" ./scripts/verify.sh golden
else skip U1 "pure tests" "N2 red"; skip V1 "golden vectors" "N2 red"; fi

# core, market, launcher in the sandbox -----------------------------------------------------------------------------------
if is_green B1; then
  if [ "$FAST" = 1 ]; then
  EXPECT=("test result: ok"); FORBID=("FAILED")
  step C1 0 "FAST core smoke in the sandbox: full lifecycle" cargo test --locked --offline -q -p kruxa-tests --test lifecycle -- --test-threads=3
  EXPECT=("test result: ok"); FORBID=("FAILED")
  step M1 0 "FAST market smoke in the sandbox: AMM and fee split" cargo test --locked --offline -q -p kruxa-tests --test market_sandbox -- --test-threads=3
  EXPECT=("test result: ok"); FORBID=("FAILED")
  step I1 0 "FAST launcher smoke in the sandbox: instant flow" cargo test --locked --offline -q -p kruxa-tests --test instant -- --test-threads=3
  else
  EXPECT=("test result: ok"); FORBID=("FAILED")
  step C1 0 "core in the sandbox: lifecycle, adversarial, creator gate, payout, hand-off, real intents.near wasm, genesis" \
    cargo test --locked --offline -q -p kruxa-tests --test lifecycle --test adversarial --test creator_gate --test payout_recipient \
      --test handoff --test intents --test real_intents --test genesis --test views_preview -- --test-threads=3
  EXPECT=("test result: ok"); FORBID=("FAILED")
  step M1 0 "market in the sandbox: AMM, fee split, caps, pause, adversarial" \
    cargo test --locked --offline -q -p kruxa-tests --test market_sandbox --test market_adversarial -- --test-threads=3
  EXPECT=("test result: ok"); FORBID=("FAILED")
  step I1 0 "launcher (Instant mode) in the sandbox: flow, adversarial, review regressions, real market" \
    cargo test --locked --offline -q -p kruxa-tests --test instant --test instant_adversarial --test instant_review \
      --test instant_market --test market_instant -- --test-threads=3
  fi
else skip C1 "core sandbox" "B1 red"; skip M1 "market sandbox" "B1 red"; skip I1 "launcher sandbox" "B1 red"; fi
if is_green N2; then
  EXPECT=("SLICES OK"); step M2 0 "market demo: buy and sell, five fee slices add up, custody unchanged" ./scripts/market-demo.sh
  EXPECT=("BOUND OK: creator never above 50% of the fee"); step M3 0 "market simulation: creator share bound over 60 days" cargo run -q --locked --offline -p market-sim -- table 60
else skip M2 "market demo" "N2 red"; skip M3 "market simulation" "N2 red"; fi

# attack gallery ----------------------------------------------------------------------------------------------------------
if is_green B1; then
  if [ "$FAST" = 1 ]; then
  EXPECT=("committed record: 0 failed"); step A1 0 "FAST attack gallery: committed record shows no failed attack (the full run re-executes all)" \
    bash -c 'f=evidence/attack-gallery/attack-gallery.json; jq -e ".ok == true and .counts.failed == 0 and .counts.succeeded_unexpectedly == 0 and .counts.invariants_held == .counts.total" "$f" >/dev/null && echo "committed record: 0 failed, $(jq -r .counts.total "$f") attacks"'
  else
  EXPECT=("ATTACK GALLERY (sandbox):" " 0 failed, 0 succeeded unexpectedly")
  step A1 0 "attack gallery: every attack refused, harmless, or a disclosed bound; invariants held" run_gallery
  fi
else skip A1 "attack gallery" "B1 red"; fi

# verify.sh tamper checks, offline: replayed records and a closed local port -----------------------------------------------
if is_green N2; then
  BOOK=$(cat fixtures/events/lifecycle.book_hash)
  EXPECT=("MATCH"); FORBID=("MISMATCH")
  step T1 0 "verify: recorded launch lifecycle replays to its recorded book hash" \
    cargo run -q --locked --offline -p kruxa-sim -- fold --events fixtures/events/lifecycle.jsonl --book-hash "$BOOK"
  EXPECT=("MISMATCH log"); step T2 2 "tamper: one micro-USDC changed in the record is detected, exit 2" \
    cargo run -q --locked --offline -p kruxa-sim -- fold --events fixtures/events/lifecycle.jsonl --book-hash "$BOOK" --tamper
  EXPECT=("RECORDED, not live" "PASS C7 mint_authority=None freeze_authority=None" "PASS C20"); FORBID=("MISMATCH")
  step T3 0 "verify: recorded Solana devnet genesis (F0, signed through NEAR Chain Signatures, real testnet core) re-checks clean" \
    ./scripts/verify.sh --evidence evidence/genesis/core2-f0-devnet-launch6-evidence.json
  EXPECT=("MISMATCH"); step T4 2 "tamper-all: every recorded Solana input flipped, each run detected, exit 2" \
    ./scripts/verify.sh --evidence evidence/genesis/core2-f0-devnet-launch6-evidence.json --tamper-all
  EXPECT=(); FORBID=("MISMATCH"); step T5 4 "dead RPC exits 4 and never prints MISMATCH" \
    cargo run -q --locked --offline -p kruxa-sim -- verify --rpc http://127.0.0.1:1 --contract core.kruxa.testnet --launch 1
else for i in T1 T2 T3 T4 T5; do skip $i "verify tamper checks" "N2 red"; done; fi

# swarm and tour -----------------------------------------------------------------------------------------------------------
if is_green N2; then
  EXPECT=("SWARM GREEN" "INVARIANTS HELD in 24 of 24 rounds" "recorded run-3.json reproduces byte-for-byte" "0 violations")
  step W1 0 "swarm: 16 agents, 24 rounds, invariants every round, recorded runs reproduce, 300-seed sweep" ./scripts/swarm-run.sh
  EXPECT=("TOUR GREEN"); step O1 0 "make tour: seven offline scenes" ./scripts/tour.sh
else skip W1 "swarm" "N2 red"; skip O1 "tour" "N2 red"; fi

# ---- tracks ------------------------------------------------------------------------------------------------------------
echo
if [ "$FAST" = 1 ]; then
  total=$(wc -l <"$OUT/steps.tsv" | tr -d ' '); red=$(awk -F'\t' '$2!="GREEN"' "$OUT/steps.tsv" | wc -l | tr -d ' ')
  echo; echo "FAST subset: $((total - red)) of $total steps green, wall $(( $(date +%s) - T_START ))s. No tracks claimed; run without --fast for the table."
  [ "$red" = 0 ] || awk -F'\t' '$2!="GREEN" {printf "  RED %s: %s %s\n", $1, $4, $5}' "$OUT/steps.tsv"
  if [ "$RECORD" = 1 ]; then
    { echo "# Fast judge run record. Written by scripts/judge-run.sh --fast --record on git ${head_sha}."
      awk -F'\t' '{printf "%-3s %-5s %5ss  %s%s\n", $1, $2, $3, $4, ($5 != "" ? "   [" $5 "]" : "")}' "$OUT/steps.tsv"
      echo "FAST subset: $((total - red)) of $total steps green, wall $(( $(date +%s) - T_START ))s."
    } >evidence/judge-fast-run.txt
  fi
  [ "$red" = 0 ]; exit $?
fi
echo
echo "== TRACKS (GREEN only if every step it rests on is GREEN in this run)"
TT=$OUT/track-table.tsv
{
  printf '# git_head\t%s\n# tracked_files_modified\t%s\n# generated\t%s\n' "$head_sha" "$dirty" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$TT"
track() { # <track name> <step ids...>
  local name=$1; shift
  local bad="" id
  for id in "$@"; do is_green "$id" || bad="$bad $id"; done
  if [ -z "$bad" ]; then
    printf '%s\tGREEN\tsteps %s\n' "$name" "$*" >>"$TT"; printf '  %-28s GREEN  steps %s\n' "$name" "$*"
  else
    printf '%s\tRED\tred or not run:%s\n' "$name" "$bad" >>"$TT"; printf '  %-28s RED    red or not run:%s\n' "$name" "$bad"
  fi
}
track_red() { # <track name> <reason>
  printf '%s\tRED\t%s\n' "$1" "$2" >>"$TT"; printf '  %-28s RED    %s\n' "$1" "$2"
}
track "Memecoins With Mechanics" V1 C1 M1 M2 M3 U1
track "AI Security & Defense" T1 T2 T3 T4 T5 A1
track "AI Swarms" W1
track "Open Innovation" P0 N1 N2 B1 U1 V1 C1 M1 M2 M3 I1 A1 T1 T2 T3 T4 T5 W1 O1
track_red "Unstoppable DeFi" "no sandbox-only proof: the dry quote needs a live Intents endpoint and the Test 1 evidence files are not committed"
if grep -qE '^thesis:' Makefile make/*.mk 2>/dev/null; then
  EXPECT=("THESIS OK"); step H1 0 "make thesis" make thesis; track "Investment Thesis" H1
else track_red "Investment Thesis" "no make thesis target in this tree; the thesis pack lives outside the repo"; fi
track_red "Agent Economy" "track cut (CHANGE-ORDER-6 E-2): no agent module is built"
echo "  (the other seven tracks have no module and are not claimed)"

# ---- result ------------------------------------------------------------------------------------------------------------
total=$(wc -l <"$OUT/steps.tsv" | tr -d ' ')
red=$(awk -F'\t' '$2!="GREEN"' "$OUT/steps.tsv" | wc -l | tr -d ' ')
wall=$(( $(date +%s) - T_START ))
echo
if [ "$red" = 0 ]; then verdict="JUDGE RUN GREEN"; rc=0; else verdict="JUDGE RUN RED"; rc=1; fi
SUMMARY="$verdict  ($((total - red)) of $total steps green, wall ${wall}s)"
echo "$SUMMARY"
[ "$red" = 0 ] || awk -F'\t' '$2!="GREEN" {printf "  RED %s: %s %s\n", $1, $4, $5}' "$OUT/steps.tsv"
echo "claimed tracks (from the table above): $(awk -F'\t' '!/^#/ && $2=="GREEN" {printf "%s%s", sep, $1; sep="; "}' "$TT")"
echo "logs: target/judge/<step>.log    table: target/judge/track-table.tsv    next: scripts/claimed-tracks.sh"

if [ "$RECORD" = 1 ]; then
  {
    echo "# Judge run record. Written by scripts/judge-run.sh --record on git ${head_sha}."
    echo "# Every quoted README output string must appear in this file or in another committed evidence file (scripts/readme-lint.sh --evidence)."
    echo "# Host: $(uname -sm), cores $(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null)"
    echo
    awk -F'\t' '{printf "%-3s %-5s %5ss  %s%s\n", $1, $2, $3, $4, ($5 != "" ? "   [" $5 "]" : "")}' "$OUT/steps.tsv"
    echo
    grep -v '^#' "$TT" | awk -F'\t' '{printf "%-28s %-5s %s\n", $1, $2, $3}'
    echo
    echo "$SUMMARY"
    echo
    echo "# Key output lines, copied from the step logs"
    for f in B1:sha256 V1:outcome= V1:spend= M2:SLICES M3:BOUND W1:SWARM W1:INVARIANTS W1:sweep A1:ATTACK T2:MISMATCH T5:exit; do
      id=${f%%:*}; pat=${f#*:}; grep -h "$pat" "$OUT/$id.log" 2>/dev/null | head -3
    done
    cat "$OUT/O1.log" 2>/dev/null
    grep -h "^RECORDED" "$OUT/T3.log" 2>/dev/null | head -1
    grep -h "MISMATCH" "$OUT/T4.log" 2>/dev/null | head -3
  } >evidence/judge-run.txt
  echo "recorded: evidence/judge-run.txt"
fi
exit $rc
