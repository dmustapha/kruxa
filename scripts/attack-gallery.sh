#!/usr/bin/env bash
# Attack gallery runner. Usage:
#   scripts/attack-gallery.sh [--network sandbox|testnet] [--sabotage <ATTACK_ID>] [--skip-build]
# Sandbox (default): runs tests/tests/attack_gallery.rs against the real core and market wasm, then aggregates the per-attack
# records into evidence/attack-gallery/attack-gallery.json and docs/ATTACK-GALLERY.md. Exit 0 only if every attack was refused,
# ran and achieved nothing, or is a disclosed bound, AND the victim invariants held. Anything else exits 1.
# --sabotage ID: test-only switch that makes that one attack succeed, to prove the gallery can go red. Writes to
#   evidence/attack-gallery/red-mode/ and never touches the main evidence file. Expected exit code: 1.
# --network testnet: NOT IMPLEMENTED. It will re-run the same attacks against the core once it is deployed on testnet,
#   and label the hashes TESTNET so they can be looked up on an explorer. Exits 3 for now.
set -euo pipefail
cd "$(dirname "$0")/.."
network=sandbox; sabotage=""; build=1
while [ $# -gt 0 ]; do
  case "$1" in
    --network) network="$2"; shift 2 ;;
    --sabotage) sabotage="$2"; shift 2 ;;
    --skip-build) build=0; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ "$network" = "testnet" ]; then
  echo "attack-gallery: --network testnet is not implemented. The core is not deployed on testnet yet." >&2
  echo "It will re-run these attacks there and label hashes TESTNET. Use the sandbox run for now." >&2
  exit 3
fi
[ "$network" = "sandbox" ] || { echo "unknown network: $network" >&2; exit 2; }

for w in kruxa_core/kruxa_core kruxa_market_contract/kruxa_market_contract kruxa_instant_contract/kruxa_instant_contract mock_ft/mock_ft mock_intents/mock_intents mock_factory/mock_factory mock_market/mock_market; do
  if [ ! -f "target/near/$w.wasm" ] && [ "$build" = 1 ]; then ./scripts/build.sh && ./scripts/market-build.sh && ./scripts/instant-build.sh; break; fi
done

root=evidence/attack-gallery
out="$root/records"; json="$root/attack-gallery.json"; doc=docs/ATTACK-GALLERY.md
if [ -n "$sabotage" ]; then out="$root/red-mode/records"; json="$root/red-mode/attack-gallery.red.json"; doc=""; fi
rm -rf "$out"; mkdir -p "$out"
log="$(dirname "$out")/run.log"

list=$(cargo test -p kruxa-tests --test attack_gallery -- --list 2>/dev/null | grep -c ': test$' || true)
set +e
KRUXA_GALLERY_OUT="$PWD/$out" KRUXA_GALLERY_SABOTAGE="$sabotage" \
  cargo test -p kruxa-tests --test attack_gallery -- --test-threads=4 >"$log" 2>&1
cargo_rc=$?
set -e

python3 - "$out" "$json" "$doc" "$list" "$cargo_rc" "$sabotage" <<'PY'
import glob, hashlib, json, os, subprocess, sys, datetime
out, jpath, doc, listed, rc, sab = sys.argv[1:7]
recs = [json.load(open(p)) for p in sorted(glob.glob(out + "/*.json"))]
ok_results = {"REFUSED", "NO_EFFECT", "BOUNDED"}
count = lambda r: sum(1 for x in recs if x["result"] == r)
bad = [x for x in recs if x["result"] not in ok_results or not x["invariants_ok"]]
missing = int(listed) - len(recs)
def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest() if os.path.exists(p) else None
gate_present = subprocess.run(["grep", "-rqs", "R_CREATOR_GATE", "contracts/", "crates/"]).returncode == 0
covered = any(x.get("expected_rule_code") == "R_CREATOR_GATE" for x in recs)
not_done = json.load(open("evidence/attack-gallery/not-done.json"))
if gate_present and not covered:
    not_done.append({"id": "CREATOR-GATE", "what": "launch by a non-allowed creator", "why": "R_CREATOR_GATE exists in the source but no gallery test covers it yet"})
elif not gate_present:
    not_done.append({"id": "CREATOR-GATE", "what": "launch created by a non-allowed creator", "why": "PENDING: R_CREATOR_GATE does not exist on this tree yet (D-1 creator gate is another workstream). Add the attack when it lands."})
kf_path = "evidence/attack-gallery/known-findings.json"
kf = json.load(open(kf_path)) if os.path.exists(kf_path) and not sab else None
head = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
doc_obj = {
    "schema": "kruxa.attack-gallery/1", "network": "SANDBOX",
    "network_note": "Hashes are near-workspaces sandbox hashes. They cannot be looked up on a public explorer. A testnet re-run is planned (scripts/attack-gallery.sh --network testnet, not implemented).",
    "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "git_head": head, "red_mode_sabotage": sab or None,
    "wasm_sha256": {n: sha(f"target/near/{n}/{n}.wasm") for n in ["kruxa_core", "kruxa_market_contract", "kruxa_instant_contract"]},
    "counts": {"total": len(recs), "tests_listed": int(listed), "refused": count("REFUSED"), "no_effect": count("NO_EFFECT"),
               "bounded": count("BOUNDED"), "failed": count("FAILED"), "succeeded_unexpectedly": count("SUCCEEDED_UNEXPECTEDLY"),
               "by_group": {"core_and_genesis": sum(1 for x in recs if x["id"][0] in "AG"), "market": sum(1 for x in recs if x["id"][0] == "M"),
                            "instant_launcher_and_market_1_1": sum(1 for x in recs if x["id"][0] == "I")},
               "invariants_held": sum(1 for x in recs if x["invariants_ok"]),
               "with_rule_code": sum(1 for x in recs if any(t["role"] == "attack" and t["rule_code"] for t in x["transactions"])),
               "attack_transactions": sum(1 for x in recs for t in x["transactions"] if t["role"] == "attack")},
    "ok": not bad and missing == 0 and int(rc) == 0 and len(recs) > 0,
    "not_done": not_done, "attacks": recs,
}
os.makedirs(os.path.dirname(jpath), exist_ok=True)
json.dump(doc_obj, open(jpath, "w"), indent=2)
c = doc_obj["counts"]
line = (f"ATTACK GALLERY ({'RED MODE ' + sab if sab else 'sandbox'}): {c['total']} attacks run, {c['refused']} refused with a rule code, "
        f"{c['no_effect']} ran with no effect, {c['bounded']} bounded (disclosed limits), {c['failed']} failed, "
        f"{c['succeeded_unexpectedly']} succeeded unexpectedly; invariants held in {c['invariants_held']}/{c['total']}; "
        f"{len(not_done)} not done (see not_done)")
if kf:
    line += f"; KNOWN FINDINGS (separate, pre-fix): {kf['counts']['exploitable']} exploitable, {kf['counts']['not_exploitable']} not exploitable, {kf['counts']['not_reproduced']} not reproduced (see docs/KNOWN-FINDINGS.md)"
print(line)
for x in bad:
    print(f"  NOT OK: {x['id']} {x['title']} -> {x['result']}")
if missing:
    print(f"  {missing} listed test(s) left no record (a test crashed before it could record)")
if doc:
    esc = lambda s: str(s).replace("|", "\\|")
    rows = []
    for x in recs:
        a = [t for t in x["transactions"] if t["role"] == "attack"]
        codes = ", ".join(sorted({t["rule_code"] for t in a if t["rule_code"]})) or "none (ran, no effect)"
        hashes = "<br>".join(f"`{t['tx']}`" for t in a[:3]) + (f"<br>+{len(a)-3} more in JSON" if len(a) > 3 else "")
        rows.append(f"| {x['id']} | {x['target']} | {esc(x['title'])} | `{x['expected_rule_code'] or 'n/a'}` | {codes} | **{x['result']}** | {'yes' if x['invariants_ok'] else 'NO'} | {hashes} |")
    nd = "\n".join(f"- **{n['id']}**: {n['what']}. {n['why']}" for n in not_done)
    g = doc_obj["counts"]["by_group"]
    kf_note = "" if not kf else f"""
## Known findings (kept apart from the counts above)

The independent review (REVIEW-INSTANT-LAUNCH.md) is reproduced against the current code in `tests/tests/known_findings.rs`. Those results are NOT
part of the attack counts and are never forced green: see `docs/KNOWN-FINDINGS.md` and `evidence/attack-gallery/known-findings.json`
({kf['counts']['exploitable']} exploitable today, {kf['counts']['not_exploitable']} not exploitable, {kf['counts']['not_reproduced']} not reproduced). `make known-findings` exits 1 while any is exploitable.
"""
    text = f"""# Attack gallery

Generated by `scripts/attack-gallery.sh` from `evidence/attack-gallery/attack-gallery.json`. Do not edit by hand.

Run: {doc_obj['generated_at']} on git `{head[:12]}`, network **SANDBOX**.
Hashes are near-workspaces sandbox hashes: they cannot be looked up on a public explorer. A testnet re-run is planned
(`--network testnet`, not implemented until the core is deployed on testnet).
These adversaries are our own red team, not an independent audit.

{line}

Groups: core and genesis {g['core_and_genesis']}, market {g['market']}, instant launcher and market 1.1.0 {g['instant_launcher_and_market_1_1']} (ids I01 and up).

Result meanings: REFUSED = the contract rejected every attack transaction with the stated rule code. NO_EFFECT = the call
ran but changed nothing that matters (idempotent replay, donation, trapped-exit attempt that still exits). BOUNDED = the
contract does NOT block it; it is limited by a stated bound (disclosed limit, not a win).

| Id | Contract | Attack | Expected code | Observed code | Result | Invariants held | Sandbox tx (SANDBOX) |
|---|---|---|---|---|---|---|---|
""" + "\n".join(rows) + f"""

## Not in the gallery

{nd}

{kf_note}
## Reproduce

`make attack-gallery` (exit 0 only if every attack was refused, had no effect, or is a disclosed bound, and invariants held).
`make attack-gallery-red` flips one attack to succeed on purpose and must exit non-zero. The test-only switch
`KRUXA_GALLERY_SABOTAGE=A11` makes the first admin call of A11 come from the owner (who is allowed), so that attack
"succeeds"; the record shows SUCCEEDED_UNEXPECTEDLY and the script exits 1. The committed proof is in
`evidence/attack-gallery/red-mode/`.

## Testnet

`scripts/attack-gallery.sh --network testnet` is a documented stub and is NOT implemented (exit 3). It will re-run the same
attacks against the core once it is deployed on testnet, and label those hashes TESTNET so they can be looked up on an explorer.
"""
    open(doc, "w").write(text)
sys.exit(0 if doc_obj["ok"] else 1)
PY
