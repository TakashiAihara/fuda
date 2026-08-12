FROM oven/bun:1

WORKDIR /app

# The whole tree, then install.
#
# Copying manifests first and installing before the source is the usual trick
# for keeping the dependency layer cached, and it was here — but it means
# naming every workspace member in this file. Adding a package then breaks the
# image with `lockfile had changes, but lockfile is frozen`, which is a build
# failure a long way from its cause. `bun install` is fast enough that the
# cache was not worth a Dockerfile that has to be edited whenever the workspace
# gains a member.
COPY . .

RUN bun install --frozen-lockfile

USER bun
EXPOSE 8787

# Migrations run inside the server on start, so there is nothing to remember
# to do first. See apps/server/src/db/migrate.ts.
CMD ["bun", "run", "apps/server/src/index.ts"]
