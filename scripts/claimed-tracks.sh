#!/usr/bin/env bash
# Derives the tracks Kruxa may list from the GREEN rows of the last `make judge` run. Nothing here is typed by hand.
#   scripts/claimed-tracks.sh                  print one GREEN track per line (exit 0), RED tracks with reasons on stderr
#   scripts/claimed-tracks.sh --json           also write submission/track-claims.json (the freeze artifact)
#   scripts/claimed-tracks.sh --table FILE     read another table (default target/judge/track-table.tsv)
#   scripts/claimed-tracks.sh --allow-stale    accept a table made on another commit (freeze runs must not)
# Exit: 0 table read; 3 table missing or made on another commit than HEAD; 64 usage.
set -uo pipefail
cd "$(dirname "$0")/.."
TABLE=target/judge/track-table.tsv; JSON=0; STALE_OK=0
while [ $# -gt 0 ]; do case "$1" in
  --json) JSON=1 ;;
  --allow-stale) STALE_OK=1 ;;
  --table) [ $# -ge 2 ] || { echo "usage: --table needs a file" >&2; exit 64; }; TABLE=$2; shift ;;
  *) echo "usage: $0 [--json] [--table FILE] [--allow-stale]" >&2; exit 64 ;;
esac; shift; done

[ -f "$TABLE" ] || { echo "no $TABLE: run 'make judge' first" >&2; exit 3; }
table_head=$(awk -F'\t' '$1=="# git_head" {print $2}' "$TABLE")
modified=$(awk -F'\t' '$1=="# tracked_files_modified" {print $2}' "$TABLE")
head_now=$(git rev-parse HEAD 2>/dev/null || echo unknown)
if [ "$table_head" != "$head_now" ] && [ "$STALE_OK" = 0 ]; then
  # Committing the run record, README or submission files after the run does not change what was run; any other change does.
  if names=$(git diff --name-only "$table_head" HEAD 2>/dev/null); then
    other=$(printf '%s\n' "$names" | grep -vE '^(evidence/judge-run\.txt|README\.md|submission/|$)' || true)
  else other=unknown; fi
  if [ -n "$other" ]; then
    echo "table was made on ${table_head:0:12}, HEAD is ${head_now:0:12} and code changed since (e.g. $(echo "$other" | head -1)): run 'make judge' again" >&2; exit 3
  fi
fi
[ "$modified" = 1 ] && echo "warning: the judge run had modified tracked files" >&2

awk -F'\t' '!/^#/ && $2=="GREEN" {print $1}' "$TABLE"
awk -F'\t' '!/^#/ && $2!="GREEN" {printf "not claimed (RED): %s: %s\n", $1, $3 > "/dev/stderr"}' "$TABLE"

if [ "$JSON" = 1 ]; then
  mkdir -p submission
  python3 -I - "$TABLE" "$table_head" "$modified" >submission/track-claims.json <<'PY'
import csv, json, sys
table, head, modified = sys.argv[1:4]
green, red = [], []
for row in csv.reader(open(table), delimiter="\t"):
    if not row or row[0].startswith("#"):
        continue
    (green if row[1] == "GREEN" else red).append({"track": row[0], "basis": row[2]} if row[1] == "GREEN" else {"track": row[0], "reason": row[2]})
json.dump({"schema": "kruxa.track-claims/1", "git_head": head, "tracked_files_modified": modified == "1",
           "source": "scripts/judge-run.sh track table", "claimed": green, "not_claimed_red": red}, sys.stdout, indent=2)
print()
PY
  echo "wrote submission/track-claims.json" >&2
fi
exit 0
