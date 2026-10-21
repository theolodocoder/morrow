# Restoring a database backup

`deploy/backup.sh` uploads one `morrow-<UTC time>.dump.gz` per night to R2. Each file is a gzipped
`pg_dump -Fc` of the whole `morrow` database. Run everything below from the repo root on the server.
`c` is shorthand for the compose command:

```sh
c() { docker compose --env-file .env.production -f docker-compose.prod.yml "$@"; }
set -a; eval "$(grep -E '^(RCLONE_CONFIG_R2_[A-Z_]+|BACKUP_[A-Z_]+)=' .env.production)"; set +a
rclone lsl "r2:$BACKUP_TARGET"                                     # pick a dump
rclone copyto "r2:$BACKUP_TARGET/morrow-20261021T031700Z.dump.gz" /tmp/morrow.dump.gz
```

## Restore into production (after data loss)

Stop everything that writes, restore into a clean database, then start again. Collab keeps documents in memory
and flushes them on shutdown, so stop it before you restore, never after.

```sh
c stop web collab api
c exec -T postgres dropdb -U morrow --if-exists morrow
c exec -T postgres createdb -U morrow morrow
gunzip -c /tmp/morrow.dump.gz | c exec -T postgres pg_restore -U morrow -d morrow --no-owner --exit-on-error
c up -d --wait            # migrate re-runs (a no-op unless the dump is older than the code), then api, collab, web
```

Writers' devices keep their own copies. When they reconnect, collab merges any words written after the dump was
taken, so a restored chapter usually recovers to the latest state on its own.

## Monthly restore test (do it: an untested backup is a hope)

Restore the newest dump into a throwaway database next to production and check it. Nothing live is touched.

```sh
c exec -T postgres createdb -U morrow restore_test
gunzip -c /tmp/morrow.dump.gz | c exec -T postgres pg_restore -U morrow -d restore_test --no-owner --exit-on-error
c exec -T postgres psql -U morrow -d restore_test -c \
  "select (select count(*) from \"user\") users, (select count(*) from works) works, (select count(*) from document_states) documents, (select max(updated_at) from document_states) newest_edit"
```

The counts should be close to production's (run the same query with `-d morrow`), and `newest_edit`
should be from the night before. Then clean up:

```sh
c exec -T postgres dropdb -U morrow restore_test
rm /tmp/morrow.dump.gz
```

Write down the date and the counts. If any step fails, fix the backup before anything else. For a deeper check
that decodes every stored manuscript, run `pnpm --filter @morrow/collab backup-check` from a checkout with Node and
the Postgres client tools, pointed at the restored database (see apps/collab/src/cli/backup-check.ts).
