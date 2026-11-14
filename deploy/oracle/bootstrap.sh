#!/usr/bin/env bash
# One-time VM setup for Ubuntu 22.04 or 24.04 (ARM A1 or x86). Run on the VM as the default user:  bash deploy/oracle/bootstrap.sh
# Idempotent. Installs Docker, opens ports 80 and 443 in the VM firewall, creates the data folder, installs the systemd units.
# It does not start the stack (you fill .env and indexer.env first) and prints no secrets.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data="${KRUXA_DATA_HOST:-/srv/kruxa/data}"

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh     # official convenience script; installs the compose plugin too
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" || true

# Oracle Ubuntu images ship iptables rules that drop everything but SSH. The cloud security list is a second, separate gate.
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport "$p" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save; else
  sudo apt-get update -y && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent && sudo netfilter-persistent save
fi

sudo mkdir -p "$data/backups" "$data/snapshot"
sudo chown -R 1000:1000 "$data"                    # uid 1000 is the "node" user inside the image

# systemd units point at the repo checkout location.
repo="$(cd "$here/../.." && pwd)"
for u in "$here"/systemd/*; do
  sed "s#@REPO@#$repo#g; s#@DATA@#$data#g" "$u" | sudo tee "/etc/systemd/system/$(basename "$u")" >/dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable kruxa.service kruxa-backup.timer kruxa-keepalive.timer
echo "ok. Log out and back in once (docker group), fill $here/.env and $here/indexer.env, then: sudo systemctl start kruxa.service kruxa-backup.timer kruxa-keepalive.timer"
