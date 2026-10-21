#!/usr/bin/env bash
# Nightly database backup: pg_dump (custom format) from the postgres container → gzip → Cloudflare R2 (rclone),
# keeping BACKUP_KEEP_DAYS days. Exits non-zero on any failure, and pings BACKUP_PING_URL (a dead-man switch such as
# healthchecks.io) on success, or BACKUP_PING_URL/fail on failure, so a silent cron gets noticed.
# Settings (RCLONE_CONFIG_R2_*, BACKUP_*) are read from .env.production. Restore: deploy/restore.md.
#   deploy/backup.sh                    back up (fails if backups aren't configured)
#   deploy/backup.sh --if-configured    same, but skip quietly while the template's placeholders are still in place
#   deploy/backup.sh rclone <args>      run rclone with these settings (remote "r2"), e.g. to list or fetch dumps
# Cron (as the deploy user, 03:17 server time):
#   17 3 * * * /home/ubuntu/morrow/deploy/backup.sh >> /home/ubuntu/morrow-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=${ENV_FILE:-.env.production}
# Only the backup lines, taken verbatim (no shell evaluation: secrets may contain & ; ? $). Surrounding quotes are
# stripped as Compose does.
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^(RCLONE_CONFIG_R2_[A-Z_]+|BACKUP_[A-Z_]+)=(.*)$ ]] || continue
  key=${BASH_REMATCH[1]} value=${BASH_REMATCH[2]}
  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value=${BASH_REMATCH[1]}; fi
  export "$key=$value"
done < "$ENV_FILE"

[[ "${1:-}" == rclone ]] && { shift; exec rclone "$@"; }
[[ $# -eq 0 || "$1" == --if-configured ]] || { echo "usage: $0 [--if-configured | rclone <args>]" >&2; exit 2; }
# The template ships placeholders; dumping and then failing to upload would only waste the night.
if [[ -z "${BACKUP_TARGET:-}" || -z "${RCLONE_CONFIG_R2_ACCESS_KEY_ID:-}" || "$RCLONE_CONFIG_R2_ACCESS_KEY_ID" == CHANGE_ME ]]; then
  msg="backups not configured in $ENV_FILE (set RCLONE_CONFIG_R2_ACCESS_KEY_ID and BACKUP_TARGET)"
  [[ "${1:-}" == --if-configured ]] && { echo "$msg; skipping"; exit 0; }
  echo "$msg" >&2
  [[ -z "${BACKUP_PING_URL:-}" ]] || curl -fsS -m 10 -o /dev/null "$BACKUP_PING_URL/fail" || true
  exit 1
fi
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}

ping() { [[ -z "${BACKUP_PING_URL:-}" ]] || curl -fsS -m 10 --retry 3 -o /dev/null "$BACKUP_PING_URL$1" || true; }
tmp=$(mktemp)
trap 'status=$?; rm -f "$tmp"; if [[ $status -ne 0 ]]; then echo "$(date -u +%FT%TZ) backup FAILED ($status)" >&2; ping /fail; fi' EXIT

compose() { docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"; }
name="morrow-$(date -u +%Y%m%dT%H%M%SZ).dump.gz"

# -Z0: gzip does the compressing once, so the file is a plain gzip of a pg_restore-able dump.
compose exec -T postgres pg_dump -U morrow -d morrow -Fc -Z0 | gzip > "$tmp"
gzip -t "$tmp"
# A dump pg_restore can't list is not a backup. pg_restore stops reading after the table of contents, so drain the
# rest: otherwise gunzip dies of SIGPIPE and pipefail fails a good backup.
gunzip -c "$tmp" | compose exec -T postgres sh -c 'pg_restore --list > /dev/null && cat > /dev/null'
rclone copyto "$tmp" "r2:$BACKUP_TARGET/$name"
rclone delete "r2:$BACKUP_TARGET" --min-age "${KEEP_DAYS}d" --include 'morrow-*.dump.gz'
echo "$(date -u +%FT%TZ) backup ok: $name ($(du -h "$tmp" | cut -f1))"
ping ""
