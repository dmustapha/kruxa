#!/usr/bin/env bash
# Re-creates the per-track evidence files the track checklists name (PLAN C3.9 / C4.4, AUDIT-PLAN item 6) from commands anyone can run.
#   ./scripts/collect-track-evidence.sh                  all seven files
#   ./scripts/collect-track-evidence.sh sim market ...   only the named ones: sim tamper dead-rpc swarm market dryquote thesis
# Writes evidence/{sim,verify-tamper,verify-dead-rpc,swarm,market,dryquote,thesis}.txt. Each file starts with the git commit and the
# exact command, then the output, then the exit code. Offline replay forms only: the only network use is the read-only 1Click dry quote
# (dryquote), which falls back to the RECORDED fixture on its own. Set KRUXA_EVIDENCE_OFFLINE=1 to skip even that.
# Exit 0 when every command produced the exit code it is expected to (tamper and dead-RPC runs are EXPECTED to exit 2 and 4).
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=evidence
HEAD_SHA=$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)
FAILED=0
SIM="cargo run -q --offline -p kruxa-sim --"

# rec <file> <expected exit> <description> <command...>
rec() {
  local file=$1 want=$2 desc=$3; shift 3
  local tmp rc; tmp=$(mktemp)
  "$@" >"$tmp" 2>&1; rc=$?
  {
    echo "# $desc"
    echo "# git $HEAD_SHA, written by scripts/collect-track-evidence.sh"
    echo "# command: $*"
    cat "$tmp"
    echo "# exit $rc (expected $want)"
  } >>"$OUT/$file"
  rm -f "$tmp"
  [ "$rc" = "$want" ] || { echo "  UNEXPECTED exit $rc (wanted $want): $desc" >&2; FAILED=1; }
}
fresh() { : >"$OUT/$1"; echo "$1"; }

sim() {
  fresh sim.txt
  rec sim.txt 0 "make sim: three volume scenarios, supply table, BOUND OK, SIM sha256" cargo run -q --offline -p market-sim -- sim 60
}

tamper() {
  local book; book=$(cat fixtures/events/lifecycle.book_hash)
  fresh verify-tamper.txt
  rec verify-tamper.txt 0 "recorded lifecycle replays to its recorded book hash" $SIM fold --events fixtures/events/lifecycle.jsonl --book-hash "$book"
  rec verify-tamper.txt 2 "tamper: one micro-USDC changed in the record is detected, exit 2" $SIM fold --events fixtures/events/lifecycle.jsonl --book-hash "$book" --tamper
  rec verify-tamper.txt 0 "recorded Solana devnet genesis re-checks clean (RECORDED, not live)" ./scripts/verify.sh --evidence evidence/genesis/core2-f0-devnet-launch6-evidence.json
  rec verify-tamper.txt 2 "tamper-all: every recorded Solana input flipped, each run detected, exit 2" ./scripts/verify.sh --evidence evidence/genesis/core2-f0-devnet-launch6-evidence.json --tamper-all
}

dead_rpc() {
  fresh verify-dead-rpc.txt
  rec verify-dead-rpc.txt 4 "dead RPC (closed local port 127.0.0.1:1) exits 4 and never prints MISMATCH" $SIM verify --rpc http://127.0.0.1:1 --contract core.kruxa.testnet --launch 1
  grep -v "^#" "$OUT/verify-dead-rpc.txt" | grep -q MISMATCH && { echo "  dead RPC printed MISMATCH" >&2; FAILED=1; }
  return 0
}

swarm() {
  fresh swarm.txt
  rec swarm.txt 0 "make swarm: 16 agents, 24 rounds, recorded runs reproduce, 300-seed sweep" ./scripts/swarm-run.sh
}

market() {
  fresh market.txt
  rec market.txt 0 "make market-demo: buy and sell, five fee slices add up, two fee_bps_applied values" ./scripts/market-demo.sh
}

dryquote() {
  fresh dryquote.txt
  local flag=""; [ "${KRUXA_EVIDENCE_OFFLINE:-0}" = 1 ] && flag=--offline
  rec dryquote.txt 0 "1Click dry quote (read-only; RECORDED fixture replay when the network is unavailable)" ./scripts/intents-dry-quote.sh $flag
}

# make thesis in place, then again on an export of the committed tree (a clean checkout): every chart hash must be identical.
thesis() {
  fresh thesis.txt
  local clean; clean=$(mktemp -d)
  rec thesis.txt 0 "make thesis in the working tree" make thesis
  git archive HEAD | tar -x -C "$clean"
  rec thesis.txt 0 "make thesis on a clean export of the committed tree (git archive HEAD)" make -C "$clean" thesis
  local a b
  a=$(awk '/^# command: /{n++} n==1' "$OUT/thesis.txt" | grep -E '^(SNAPSHOT|CHART|THESIS)')
  b=$(awk '/^# command: /{n++} n==2' "$OUT/thesis.txt" | grep -E '^(SNAPSHOT|CHART|THESIS)')
  if [ "$a" = "$b" ] && [ -n "$a" ]; then echo "# CLEAN-EXPORT HASHES IDENTICAL: $(echo "$a" | grep -c '^CHART') chart hashes and the THESIS.md hash match" >>"$OUT/thesis.txt"
  else echo "# CLEAN-EXPORT HASHES DIFFER" >>"$OUT/thesis.txt"; FAILED=1; fi
  rm -rf "$clean"
}

ALL=(sim tamper dead_rpc swarm market dryquote thesis)
if [ "$#" -gt 0 ]; then ALL=(); for a in "$@"; do ALL+=("${a//-/_}"); done; fi
for step in "${ALL[@]}"; do
  case "$step" in sim|tamper|dead_rpc|swarm|market|dryquote|thesis) ;; *) echo "unknown: $step" >&2; exit 64 ;; esac
  echo "== $step"; "$step"
done
[ "$FAILED" = 0 ] && echo "TRACK EVIDENCE OK" || { echo "TRACK EVIDENCE: UNEXPECTED RESULT (see stderr above)" >&2; exit 1; }
