#!/usr/bin/env bash
# Nightly: consistent copy of the SQLite file (VACUUM INTO, safe while the indexer writes), gzip, prune, and a fresh RECORDED snapshot bake.
# Optional off-box copy: set BACKUP_RCLONE_REMOTE (for example oci:kruxa-backups) after configuring rclone for Oracle Object Storage.
# Off-box matters: if Oracle reclaims the VM, a copy that lives only on its disk is lost with it.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
data="${KRUXA_DATA_HOST:-/srv/kruxa/data}"
keep_days="${BACKUP_KEEP_DAYS:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dc() { docker compose exec -T indexer "$@"; }

dc node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/data/indexer.db',{readOnly:true});
db.exec(\"VACUUM INTO '/data/backups/indexer-$stamp.db'\");
db.close();"
dc gzip -f "/data/backups/indexer-$stamp.db"
find "$data/backups" -name 'indexer-*.db.gz' -mtime +"$keep_days" -delete

./bake-snapshot.sh

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  rclone copy "$data/backups/indexer-$stamp.db.gz" "$BACKUP_RCLONE_REMOTE"
  rclone copy "$data/snapshot" "$BACKUP_RCLONE_REMOTE/snapshot"
fi
echo "backup ok: $data/backups/indexer-$stamp.db.gz"
