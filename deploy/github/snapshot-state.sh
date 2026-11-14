#!/usr/bin/env bash
# Keeps the indexer SQLite file between scheduled runs on an orphan branch (default `snapshot-state`), so history is not lost
# when an Actions cache expires. Each push REPLACES the branch with a single commit: no history, no growth. Public chain data only.
#   snapshot-state.sh restore <dir>      fetch the branch and unpack <dir>/indexer.db and <dir>/meta.json (empty <dir> when the branch does not exist yet)
#   snapshot-state.sh push <db> <meta>   gzip the database and force-push it with its meta
# Env: STATE_BRANCH (snapshot-state), STATE_REMOTE (origin). In Actions the checkout step's token is reused for the push.
set -euo pipefail
branch="${STATE_BRANCH:-snapshot-state}"
remote="${STATE_REMOTE:-origin}"
cmd="${1:?usage: snapshot-state.sh restore <dir> | push <db> <meta>}"

restore() {
  local dir="$1" tmp
  mkdir -p "$dir"
  if ! git ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
    echo "no $branch branch yet: first run starts a fresh database"
    return 0
  fi
  tmp="$(mktemp -d)"
  git fetch --quiet --depth=1 "$remote" "+$branch:refs/kruxa-state"
  git --work-tree="$tmp" checkout refs/kruxa-state -- state
  gunzip -c "$tmp/state/indexer.db.gz" > "$dir/indexer.db"
  cp "$tmp/state/meta.json" "$dir/meta.json"
  rm -rf "$tmp"
  # A damaged file must stop the run, not be "repaired" into an empty history.
  node -e 'const {DatabaseSync}=require("node:sqlite");const r=new DatabaseSync(process.argv[1]).prepare("PRAGMA integrity_check").get();if(Object.values(r)[0]!=="ok"){console.error("restored database failed integrity_check");process.exit(1)}' "$dir/indexer.db"
  echo "restored $(du -h "$dir/indexer.db" | cut -f1) database from $branch"
}

push() {
  local db="$1" meta="$2" tmp header url
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/state"
  gzip -9 -c "$db" > "$tmp/state/indexer.db.gz"
  cp "$meta" "$tmp/state/meta.json"
  url="$(git remote get-url "$remote")"
  header="$(git config --get-all http.https://github.com/.extraheader || true)"
  git -C "$tmp" init --quiet -b "$branch"
  [ -n "$header" ] && git -C "$tmp" config http.https://github.com/.extraheader "$header"
  git -C "$tmp" add -A
  git -C "$tmp" -c user.name=kruxa-snapshot -c user.email=snapshot@users.noreply.github.com commit --quiet -m "snapshot state $(date -u +%Y-%m-%dT%H:%MZ)"
  git -C "$tmp" push --quiet --force "$url" "$branch:$branch"
  rm -rf "$tmp"
  echo "pushed state to $branch"
}

case "$cmd" in
  restore) restore "${2:?dir}" ;;
  push) push "${2:?db}" "${3:?meta}" ;;
  *) echo "unknown command $cmd" >&2; exit 2 ;;
esac
