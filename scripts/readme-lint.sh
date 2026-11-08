#!/usr/bin/env bash
# README lint. Fails (exit 1) on anything a judge could catch us overclaiming.
#   scripts/readme-lint.sh [--evidence] [FILE...]      default FILE: README.md
# Always checked:
#   em-dashes; placeholders (TODO, TBD, YOUR_, <insert...>); evidence tags ([UNVERIFIED], [ASSUMED], [OPEN]);
#   words the project may not claim (docs/INVARIANTS.md MUST NOT CLAIM); any "mainnet" line that is not negated or qualified;
#   any track name outside a "Not claimed" section that scripts/claimed-tracks.sh does not list as GREEN;
#   Instant mode: at most ONE line, labelled "Instant mode (testnet only)", not in the first 12 lines;
#   relative links, ./scripts paths and `make` targets must exist; length at most 300 lines.
# With --evidence (RL-1):
#   every line inside a fenced block whose info string is `expected` must appear verbatim in evidence/ (evidence/judge-run.txt
#   first) or in target/judge/*.log; "N attacks" must equal the committed gallery total; forbidden figures ("13/13") fail;
#   an Instant line also needs evidence/instant-testnet/flow-a.json and a GREEN I1 row in evidence/judge-run.txt.
# GENESIS_STATE=NOGO adds NG-1: the first 12 lines name a proof command and never mention Instant.
set -uo pipefail
cd "$(dirname "$0")/.."
EVIDENCE=0; FILES=()
for a in "$@"; do case "$a" in --evidence) EVIDENCE=1 ;; -*) echo "usage: $0 [--evidence] [FILE...]" >&2; exit 64 ;; *) FILES+=("$a") ;; esac; done
[ ${#FILES[@]} -gt 0 ] || FILES=(README.md)

claimed=$(./scripts/claimed-tracks.sh 2>/tmp/claimed-tracks.err.$$); crc=$?
CLAIMED_ERR=""; [ "$crc" = 0 ] || CLAIMED_ERR=$(cat /tmp/claimed-tracks.err.$$)
rm -f /tmp/claimed-tracks.err.$$

CLAIMED="$claimed" CLAIMED_ERR="$CLAIMED_ERR" EVIDENCE="$EVIDENCE" NOGO="${GENESIS_STATE:-}" \
python3 -I - "${FILES[@]}" <<'PY'
import glob, json, os, re, sys

evidence_mode = os.environ["EVIDENCE"] == "1"
nogo = os.environ["NOGO"] == "NOGO"
claimed = {l.strip() for l in os.environ["CLAIMED"].splitlines() if l.strip()}
claimed_err = os.environ["CLAIMED_ERR"].strip()

TRACKS = {
    "Unstoppable DeFi": r"Unstoppable DeFi",
    "Investment Thesis": r"Investment Thesis",
    "Privacy & Private AI": r"Privacy (?:&|and) Private AI",
    "Autonomous Business": r"Autonomous Business",
    "AI Swarms": r"AI Swarms",
    "AI Security & Defense": r"AI Security (?:&|and) Defen[sc]e",
    "Agent Economy": r"Agent Economy",
    "Real-World Money": r"Real[- ]World Money",
    "Games With Real Economies": r"Games With Real Economies",
    "NFTs That Do Something": r"NFTs That Do Something",
    "Memecoins With Mechanics": r"Memecoins With Mechanics",
    "Social Money": r"Social Money",
    "Open Innovation": r"Open Innovation",
}
FORBIDDEN = [  # docs/INVARIANTS.md MUST NOT CLAIM, plus plain overclaim words
    r"rug[- ]?proof", r"\bno rug\b", r"cannot be rugged", r"can'?t be rugged", r"\btrustless\b", r"\bno admin\b", r"\bimmutable\b",
    r"\baudited\b", r"\bsecure\b", r"\bsafe\b", r"\bprotected\b", r"trial-verified", r"production[- ]ready", r"battle[- ]tested",
    r"\bthe first\b", r"first[- ]of[- ]its[- ]kind", r"\bunique\b", r"\bnovel\b", r"no competitors?",
    r"100% (?:of your principal )?back", r"refunded to the origin chain", r"emergent economy", r"sybil[- ]resist", r"TEE-verified",
    r"\bprofit", r"\brevenue\b", r"break-?even", r"investment advice", r"\bguaranteed\b",
]
PLACEHOLDERS = [r"\bTODO\b", r"\bTBD\b", r"\bFIXME\b", r"\bXXX\b", r"lorem ipsum", r"YOUR_[A-Z_]+", r"<insert[^>]*>", r"<your[^>]*>",
                r"\bCHANGEME\b", r"\bcoming soon\b", r"\[PLACEHOLDER", r"\bplaceholder\b"]
FORBIDDEN_FIGURES = [r"13/13", r"\b13 of 13\b"]
TAGS = r"\[(?:UNVERIFIED|ASSUMED|OPEN|VERIFIED|PROVEN)[^\]]*\]"
MAINNET_OK = re.compile(r"\b(?:not|no|never|none|nothing|without|only|planned|recorded|forbidden|refus\w*|zero|cannot|until|before)\b", re.I)

def make_targets():
    t = set()
    for f in ["Makefile"] + glob.glob("make/*.mk"):
        for l in open(f):
            m = re.match(r"^([A-Za-z0-9_.-]+)\s*:(?!=)", l)
            if m:
                t.add(m.group(1))
    return t
MAKE = make_targets()

def evidence_corpus():
    parts = []
    for p in ["evidence/judge-run.txt"] + sorted(glob.glob("evidence/**/*", recursive=True)) + sorted(glob.glob("target/judge/*.log")):
        if os.path.isfile(p) and os.path.getsize(p) < 8_000_000:
            try:
                parts.append(open(p, errors="ignore").read())
            except OSError:
                pass
    return "\n".join(parts)

problems = []
def fail(f, n, rule, msg):
    problems.append(f"FAIL {rule} {f}:{n}: {msg}")

def lint(path):
    if not os.path.isfile(path):
        fail(path, 0, "file", "does not exist"); return
    lines = open(path, encoding="utf-8").read().split("\n")
    if len(lines) > 300:
        fail(path, 301, "length", f"{len(lines)} lines, limit 300")
    # pass 1: structure (fences, headings, not-claimed sections)
    in_fence = False; info = ""; fence_of = {}; section_ok = {}; notclaimed = False; nc_level = 0
    expected_lines = []
    for i, l in enumerate(lines, 1):
        s = l.strip()
        if s.startswith("```"):
            if not in_fence:
                in_fence = True; info = s[3:].strip()
            else:
                in_fence = False; info = ""
            fence_of[i] = True; continue
        fence_of[i] = in_fence
        if in_fence and info == "expected" and s:
            expected_lines.append((i, s))
        if not in_fence:
            m = re.match(r"^(#+)\s+(.*)", l)
            if m:
                lvl = len(m.group(1))
                if notclaimed and lvl <= nc_level:
                    notclaimed = False
                if re.search(r"not claimed|not listed", m.group(2), re.I):
                    notclaimed = True; nc_level = lvl
        section_ok[i] = notclaimed
    prose = [(i, l) for i, l in enumerate(lines, 1) if not fence_of[i]]
    # em-dash, placeholders, tags, forbidden words, mainnet: every line, fenced or not
    for i, l in enumerate(lines, 1):
        if "—" in l or "&mdash;" in l:
            fail(path, i, "em-dash", "em-dash present")
        for p in PLACEHOLDERS:
            if re.search(p, l, re.I):
                fail(path, i, "placeholder", f"matches {p}")
        if re.search(TAGS, l):
            fail(path, i, "evidence-tag", "internal tag in a judge-facing file: " + re.search(TAGS, l).group(0))
        for p in FORBIDDEN:
            m = re.search(p, l, re.I)
            if m:
                fail(path, i, "forbidden-claim", f"'{m.group(0)}' may not be claimed (docs/INVARIANTS.md MUST NOT CLAIM)")
        if re.search(r"mainnet", l, re.I) and not fence_of[i] and not MAINNET_OK.search(l):
            fail(path, i, "mainnet", "a mainnet line must be negated or qualified (not, no, never, only, planned, recorded)")
        if evidence_mode:
            for p in FORBIDDEN_FIGURES:
                if re.search(p, l):
                    fail(path, i, "forbidden-figure", f"'{p}' is not a recomputable figure")
    # tracks
    if claimed_err:
        fail(path, 0, "tracks", "cannot derive the green tracks: " + claimed_err.splitlines()[-1])
    else:
        for i, l in prose:
            if section_ok[i]:
                continue
            for name, rx in TRACKS.items():
                if re.search(rx, l, re.I) and name not in claimed:
                    fail(path, i, "track", f"names track '{name}' outside a 'Not claimed' section but its judge row is not GREEN")
    # instant
    inst = [(i, l) for i, l in prose if re.search(r"instant", l, re.I)]
    if len(inst) > 1:
        fail(path, inst[1][0], "instant", f"Instant appears on {len(inst)} lines; the limit is one labelled line (lines {[i for i, _ in inst]})")
    for i, l in inst:
        if not re.match(r"^\W*Instant mode \(testnet only\)", l):
            fail(path, i, "instant", "the one Instant line must start with the label 'Instant mode (testnet only)'")
        if "testnet" not in l.lower():
            fail(path, i, "instant", "the Instant line must say testnet")
        if i <= 12:
            fail(path, i, "instant", "Instant may not appear in the first 12 lines")
        if evidence_mode:
            if not os.path.isfile("evidence/instant-testnet/flow-a.json"):
                fail(path, i, "instant", "no evidence/instant-testnet/flow-a.json")
            jr = open("evidence/judge-run.txt").read() if os.path.isfile("evidence/judge-run.txt") else ""
            if not re.search(r"^I1\s+GREEN", jr, re.M):
                fail(path, i, "instant", "no GREEN I1 row in evidence/judge-run.txt (launcher sandbox suite)")
    # links, scripts, make targets
    for i, l in enumerate(lines, 1):
        for m in re.finditer(r"\]\(([^)\s]+)\)", l):
            tgt = m.group(1)
            if re.match(r"^(?:https?:|mailto:|#)", tgt):
                continue
            if not os.path.exists(tgt.split("#")[0]):
                fail(path, i, "link", f"relative link target does not exist: {tgt}")
        for m in re.finditer(r"(?<![\w/.])(?:\./)?(scripts/[\w./-]+\.(?:sh|py|mjs))", l):
            if not os.path.isfile(m.group(1)):
                fail(path, i, "script", f"{m.group(1)} does not exist")
        for m in re.finditer(r"\bmake ([a-z][\w-]*)", l):
            if m.group(1) not in MAKE:
                fail(path, i, "make", f"no make target '{m.group(1)}'")
        for m in re.finditer(r"`((?:(?:docs|evidence|fixtures|contracts|crates|tools|tests|app|services)/[\w./-]+|[A-Z][A-Z-]*)\.(?:md|json|txt|sh|rs|toml|jsonl))`", l):
            if not os.path.exists(m.group(1)):
                fail(path, i, "path", f"{m.group(1)} does not exist")
    # evidence rules
    if evidence_mode:
        corpus = evidence_corpus()
        for i, s in expected_lines:
            if s not in corpus:
                fail(path, i, "evidence", f"expected output line not found in evidence/ or target/judge: {s[:90]}")
        gal = "evidence/attack-gallery/attack-gallery.json"
        total = json.load(open(gal))["counts"]["total"] if os.path.isfile(gal) else None
        for i, l in prose:
            for m in re.finditer(r"(\d[\d,]*)\s+(?:sandbox\s+)?attacks", l):
                n = int(m.group(1).replace(",", ""))
                if total is None or n != total:
                    fail(path, i, "figure", f"'{m.group(0)}' but the committed gallery total is {total}")
    if nogo:
        head = "\n".join(lines[:12])
        if not re.search(r"make judge|verify\.sh", head):
            fail(path, 1, "NG-1", "the first 12 lines must name one proof command (make judge or ./scripts/verify.sh)")

for f in sys.argv[1:]:
    lint(f)
for p in problems:
    print(p)
mode = "evidence" if evidence_mode else "basic"
if problems:
    print(f"README LINT FAIL ({len(problems)} problems, mode {mode})")
    sys.exit(1)
print(f"README LINT OK ({', '.join(sys.argv[1:])}, mode {mode})")
PY
