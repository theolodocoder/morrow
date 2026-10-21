#!/usr/bin/env bash
# Nightly database backup: pg_dump (custom format) from the postgres container → gzip → Cloudflare R2 (rclone),
# keeping BACKUP_KEEP_DAYS days. Exits non-zero on any failure, so cron mail / a monitor can catch it.
# Settings (RCLONE_CONFIG_R2_*, BACKUP_*) are read from .env.production. Restore: deploy/restore.md.
# Cron (as the deploy user, 03:17 server time):
#   17 3 * * * /home/ubuntu/morrow/deploy/backup.sh >> /home/ubuntu/morrow-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=${ENV_FILE:-.env.production}
# Only the backup lines: the rest of the file is compose syntax, not shell.
set -a
eval "$(grep -E '^(RCLONE_CONFIG_R2_[A-Z_]+|BACKUP_[A-Z_]+)=' "$ENV_FILE")"
set +a
: "${BACKUP_TARGET:?set BACKUP_TARGET in $ENV_FILE}"
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}

compose() { docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"; }
name="morrow-$(date -u +%Y%m%dT%H%M%SZ).dump.gz"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

# -Z0: gzip does the compressing once, so the file is a plain gzip of a pg_restore-able dump.
compose exec -T postgres pg_dump -U morrow -d morrow -Fc -Z0 | gzip > "$tmp"
# A dump pg_restore can't list is not a backup.
gunzip -c "$tmp" | compose exec -T postgres pg_restore --list > /dev/null
rclone copyto "$tmp" "r2:$BACKUP_TARGET/$name"
rclone delete "r2:$BACKUP_TARGET" --min-age "${KEEP_DAYS}d" --include 'morrow-*.dump.gz'
echo "$(date -u +%FT%TZ) backup ok: $name ($(du -h "$tmp" | cut -f1))"
