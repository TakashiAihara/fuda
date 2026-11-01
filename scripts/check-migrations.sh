#!/usr/bin/env bash
# Fails when schema.ts and the committed migrations disagree.
# drizzle-kit cannot ask "rename or drop and add?" without a terminal: it then
# writes nothing and exits 0, so an empty working tree alone proves nothing. Its
# own "nothing to migrate" line has to be there too.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

out=$(bun run db:generate </dev/null 2>&1)
status=$?
printf '%s\n' "$out"

if [ "$status" -ne 0 ]; then
  echo "check-migrations: db:generate failed (exit $status)" >&2
  exit 1
fi

if ! printf '%s\n' "$out" | grep -qF 'No schema changes, nothing to migrate'; then
  echo "check-migrations: db:generate did not report that there is nothing to migrate" >&2
  exit 1
fi

drift=$(git status --porcelain --untracked-files=all -- apps/server/drizzle) || {
  echo "check-migrations: git status failed, so drift cannot be checked" >&2
  exit 1
}
if [ -n "$drift" ]; then
  echo "check-migrations: schema.ts and the migrations have drifted apart:" >&2
  printf '%s\n' "$drift" >&2
  exit 1
fi
