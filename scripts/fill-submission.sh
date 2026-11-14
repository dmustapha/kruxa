#!/usr/bin/env bash
# Fill the submission package placeholders from the repo's own records. Never edits README.md.
#   scripts/fill-submission.sh [--values FILE] [--out DIR] [--no-evidence-check] [--in-place]
#
# Reads:   artifacts/SHA256SUMS (hashes; each is re-checked against the file), artifacts/BUILD-KIND (core build commit),
#          evidence/judge-run.txt (git head, steps, wall time, GREEN tracks, local core hash),
#          evidence/judge-fast-run.txt (fast steps and wall time), git rev-parse HEAD,
#          submission/track-claims.json, submission/values.env (the owner's values; see that file).
# Fills:   submission/FORM-PAYLOAD.md, proof.md, links.md, xpost-material.md, video-script.md, evidence/wire.md.
# Writes:  by default into ../kruxa-submission-filled/ (outside the repo, because the filled form holds the lead's email).
#          --in-place also overwrites the five public templates (never FORM-PAYLOAD.md) with their filled text.
# Refuses (exit 1, writes nothing) if:
#   - any placeholder is still unresolved, or a required value is empty;
#   - a hash in SHA256SUMS does not equal the file's real sha256;
#   - evidence/judge-run.txt is not GREEN, or its GREEN track set differs from track-claims.json or from the form's tracks array;
#   - the preferred track is not a claimed track, or a RED track name appears in the form;
#   - the description is outside 20 to 2,000 characters;
#   - any em dash or en dash appears in the filled text;
#   - a backticked repo path in the filled text does not exist;
#   - an `expected` block line is not found verbatim under evidence/ (skip with --no-evidence-check).
# Exit: 0 filled, 1 refused, 64 usage. Needs python3 and git. No network, no keys.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VALUES="submission/values.env"; OUT="$ROOT/../kruxa-submission-filled"; EVCHECK=1; INPLACE=0
while [ "$#" -gt 0 ]; do case "$1" in
  --values) [ "$#" -ge 2 ] || { echo "usage: --values needs a file" >&2; exit 64; }; VALUES="$2"; shift ;;
  --out) [ "$#" -ge 2 ] || { echo "usage: --out needs a directory" >&2; exit 64; }; OUT="$2"; shift ;;
  --no-evidence-check) EVCHECK=0 ;;
  --in-place) INPLACE=1 ;;
  *) echo "usage: $0 [--values FILE] [--out DIR] [--no-evidence-check] [--in-place]" >&2; exit 64 ;;
esac; shift; done
command -v python3 >/dev/null || { echo "REFUSED: python3 not found" >&2; exit 1; }
GIT_HEAD="$(git rev-parse HEAD 2>/dev/null)" || { echo "REFUSED: git rev-parse HEAD failed" >&2; exit 1; }

GIT_HEAD="$GIT_HEAD" VALUES="$VALUES" OUT="$OUT" EVCHECK="$EVCHECK" INPLACE="$INPLACE" ROOT="$ROOT" python3 -I - <<'PY'
import hashlib, json, os, re, sys

root = os.environ["ROOT"]
os.chdir(root)
errors = []
def refuse(msgs):
    for m in msgs: print("REFUSED: " + m, file=sys.stderr)
    sys.exit(1)
def read(p):
    try:
        with open(p, encoding="utf-8") as f: return f.read()
    except OSError as e:
        refuse([f"cannot read {p}: {e.strerror}"])

# Files this script may fill. README.md is never among them.
TEMPLATES = {
    "submission/FORM-PAYLOAD.md": "FORM-PAYLOAD.md",
    "submission/proof.md": "proof.md",
    "submission/links.md": "links.md",
    "submission/xpost-material.md": "xpost-material.md",
    "submission/video-script.md": "video-script.md",
    "evidence/wire.md": "wire.md",
}
assert "README.md" not in TEMPLATES and not any(p.endswith("/README.md") or p == "README.md" for p in TEMPLATES)

# ---- owner values (environment wins, so the email never has to sit in the repo) ----
REQUIRED = ["CORE_ACCOUNT", "MARKET_ACCOUNT", "LAUNCHER_ACCOUNT", "REPO_URL", "X_POST_URL", "VIDEO_URL",
            "PAYOUT_ACCOUNT", "TEAM_LEAD", "TEAM_EMAIL", "TEAM_SIZE", "PREFERRED_TRACK", "RELEASE_TAG"]
vals = {}
for line in read(os.environ["VALUES"]).splitlines():
    s = line.strip()
    if not s or s.startswith("#") or "=" not in s: continue
    k, v = s.split("=", 1)
    vals[k.strip()] = v.strip().strip('"').strip("'")
for k in REQUIRED:
    if os.environ.get(k): vals[k] = os.environ[k]
    if not vals.get(k): errors.append(f"value {k} is empty (set it in {os.environ['VALUES']} or the environment)")
for k in ("CORE_ACCOUNT", "MARKET_ACCOUNT", "LAUNCHER_ACCOUNT", "PAYOUT_ACCOUNT"):
    if vals.get(k) and not re.fullmatch(r"[a-z0-9._-]{2,64}", vals[k]): errors.append(f"{k} is not a NEAR account name: {vals[k]!r}")
for k in ("REPO_URL", "X_POST_URL", "VIDEO_URL"):
    if vals.get(k) and not re.fullmatch(r"https://\S+", vals[k]): errors.append(f"{k} must start with https:// and hold no spaces")
if vals.get("TEAM_EMAIL") and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", vals["TEAM_EMAIL"]): errors.append("TEAM_EMAIL is not an email address")
if vals.get("TEAM_SIZE") and not re.fullmatch(r"[0-9]{1,3}", vals["TEAM_SIZE"]): errors.append("TEAM_SIZE must be a number")

# ---- hashes from artifacts/SHA256SUMS, each re-checked against the real file ----
sums = {}
for line in read("artifacts/SHA256SUMS").splitlines():
    m = re.fullmatch(r"([0-9a-f]{64})\s+(\S+)", line.strip())
    if m: sums[os.path.basename(m.group(2))] = (m.group(1), m.group(2))
def sha_of(name):
    if name not in sums:
        errors.append(f"artifacts/SHA256SUMS has no row for {name}"); return "", 0
    h, path = sums[name]
    if not os.path.isfile(path):
        errors.append(f"{path} listed in SHA256SUMS does not exist"); return h, 0
    with open(path, "rb") as f: data = f.read()
    real = hashlib.sha256(data).hexdigest()
    if real != h: errors.append(f"{path}: SHA256SUMS says {h[:12]}... but the file is {real[:12]}...")
    return h, len(data)
core, core_bytes = sha_of("kruxa_core.wasm")
market, _ = sha_of("kruxa_market_contract.wasm")
launcher, _ = sha_of("kruxa_instant_contract.wasm")

bk = read("artifacts/BUILD-KIND")
m = re.search(r"built from commit ([0-9a-f]{40})", bk)
if not m: errors.append("artifacts/BUILD-KIND names no core build commit")
build_commit = m.group(1) if m else ""

# ---- judge records ----
jr = read("evidence/judge-run.txt")
m = re.search(r"Written by .* on git ([0-9a-f]{40})", jr.splitlines()[0] if jr else "")
judge_git = m.group(1) if m else ""
if not m: errors.append("evidence/judge-run.txt header does not name a git head")
m = re.search(r"^JUDGE RUN GREEN\s+\((\d+ of \d+) steps green, wall (\d+)s\)", jr, re.M)
if not m: errors.append("evidence/judge-run.txt has no 'JUDGE RUN GREEN (N of N steps green, wall Ns)' line")
judge_steps, judge_wall = (m.group(1), m.group(2)) if m else ("", "")
if m and len(set(re.findall(r"\d+", judge_steps))) != 1: errors.append(f"judge run is not N of N: {judge_steps}")
m = re.search(r"^sha256 kruxa_core\.wasm ([0-9a-f]{64}) \d+ bytes", jr, re.M)
if not m: errors.append("evidence/judge-run.txt has no 'sha256 kruxa_core.wasm' key line")
judge_local_core = m.group(1) if m else ""
green_tracks = set(re.findall(r"^([A-Za-z][A-Za-z &]{3,}?)\s{2,}GREEN\s+steps\s", jr, re.M))

fr = read("evidence/judge-fast-run.txt")
m = re.search(r"^FAST subset: (\d+ of \d+) steps green, wall (\d+)s\.", fr, re.M)
if not m: errors.append("evidence/judge-fast-run.txt has no 'FAST subset: N of N steps green, wall Ns.' line")
fast_steps, fast_wall = (m.group(1), m.group(2)) if m else ("", "")

# ---- track claims ----
tc = json.loads(read("submission/track-claims.json"))
claimed = [t["track"] for t in tc["claimed"]]
red = [t["track"] for t in tc.get("not_claimed_red", [])]
if set(claimed) != green_tracks:
    errors.append("track-claims.json claimed set differs from the GREEN tracks in evidence/judge-run.txt: "
                  f"only in claims {sorted(set(claimed) - green_tracks)}, only in judge run {sorted(green_tracks - set(claimed))}")
if vals.get("PREFERRED_TRACK") and vals["PREFERRED_TRACK"] not in claimed:
    errors.append(f"PREFERRED_TRACK {vals['PREFERRED_TRACK']!r} is not a claimed track {claimed}")

if errors: refuse(errors)

# ---- substitution map ----
sub = dict(vals)
sub.update({
    "GIT_HEAD": os.environ["GIT_HEAD"], "GIT_HEAD_SHORT": os.environ["GIT_HEAD"][:7],
    "JUDGE_GIT_SHORT": judge_git[:7], "JUDGE_STEPS": judge_steps, "JUDGE_WALL_S": judge_wall,
    "JUDGE_LOCAL_CORE_SHA256_SHORT": judge_local_core[:8],
    "FAST_STEPS": fast_steps, "FAST_WALL_S": fast_wall,
    "CORE_SHA256": core, "CORE_SHA256_SHORT": core[:8], "CORE_BYTES": f"{core_bytes:,}",
    "MARKET_SHA256": market, "MARKET_SHA256_SHORT": market[:8],
    "LAUNCHER_SHA256": launcher, "LAUNCHER_SHA256_SHORT": launcher[:8],
    "CORE_BUILD_COMMIT_SHORT": build_commit[:7],
    "CORE_EXPLORER_URL": "https://testnet.nearblocks.io/address/" + vals["CORE_ACCOUNT"],
})
PH = re.compile(r"\{\{([A-Za-z0-9_]+)\}\}")
filled, unresolved = {}, []
for src in TEMPLATES:
    text = read(src)
    for k in sorted(set(PH.findall(text))):
        if k not in sub or not str(sub[k]): unresolved.append(f"{src}: unresolved placeholder {{{{{k}}}}}")
    filled[src] = PH.sub(lambda mo: str(sub.get(mo.group(1), mo.group(0))), text)
if unresolved: refuse(unresolved)

# ---- checks on the filled text ----
problems = []
for src, text in filled.items():
    if "\u2014" in text or "\u2013" in text: problems.append(f"{src}: contains an em dash or en dash")
    if PH.search(text): problems.append(f"{src}: a placeholder remains after substitution")
form = filled["submission/FORM-PAYLOAD.md"]
m = re.search(r"<!-- DESCRIPTION-START -->\n(.*?)\n<!-- DESCRIPTION-END -->", form, re.S)
desc = m.group(1).strip() if m else ""
if not m: problems.append("FORM-PAYLOAD.md has no description markers")
elif not 20 <= len(desc) <= 2000: problems.append(f"description is {len(desc)} characters, the form allows 20 to 2,000")
m = re.search(r"```json\n(\[.*?\])\n```", form, re.S)
try: form_tracks = json.loads(m.group(1)) if m else None
except ValueError: form_tracks = None
if form_tracks is None: problems.append("FORM-PAYLOAD.md has no tracks array")
elif set(form_tracks) != set(claimed): problems.append(f"form tracks {form_tracks} differ from track-claims.json {claimed}")
for r in red:
    if r in form: problems.append(f"FORM-PAYLOAD.md names the RED track {r!r}")
if vals["PREFERRED_TRACK"] not in desc: problems.append("the description does not name the preferred track")

PATHRE = re.compile(r"`([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:md|json|txt|sh|rs|toml|py|ts|wasm|env))`")
for src, text in filled.items():
    for p in sorted(set(PATHRE.findall(text))):
        if p.startswith("submission/filled/") or "*" in p: continue
        if "/" not in p and p in ("FORM-PAYLOAD.md", "verify.sh"): continue  # bare names used in prose
        if not os.path.exists(p): problems.append(f"{src}: path `{p}` does not exist")

if os.environ["EVCHECK"] == "1":
    ev = []
    for d, _, fs in os.walk("evidence"):
        for fn in fs:
            if fn == "wire.md": continue
            try:
                with open(os.path.join(d, fn), encoding="utf-8", errors="ignore") as f: ev.append(f.read())
            except OSError: pass
    blob = "\n".join(ev)
    for src, text in filled.items():
        for blk in re.findall(r"```expected\n(.*?)\n```", text, re.S):
            for ln in blk.splitlines():
                if ln.strip() and ln not in blob: problems.append(f"{src}: expected line not found in evidence/: {ln[:90]}")
if problems: refuse(problems)

# ---- write ----
out = os.path.abspath(os.environ["OUT"])
os.makedirs(out, exist_ok=True)
for src, text in filled.items():
    with open(os.path.join(out, TEMPLATES[src]), "w", encoding="utf-8") as f: f.write(text)
if os.environ["INPLACE"] == "1":
    for src, text in filled.items():
        if src == "submission/FORM-PAYLOAD.md": continue  # holds the lead's email; stays outside the repo
        with open(src, "w", encoding="utf-8") as f: f.write(text)
print(f"FILLED {len(filled)} files into {out}")
print(f"description: {len(desc)} characters (form allows 20 to 2,000)")
print(f"core {core[:8]} ({core_bytes} bytes) head {os.environ['GIT_HEAD'][:7]} judge {judge_steps} steps, {judge_wall}s on {judge_git[:7]}; fast {fast_steps}, {fast_wall}s")
if judge_git != os.environ["GIT_HEAD"]:
    print(f"NOTE: judge record was written on {judge_git[:7]}, repo head is {os.environ['GIT_HEAD'][:7]}; say so if the form or post gives that commit")
PY
