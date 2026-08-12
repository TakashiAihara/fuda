FROM oven/bun:1

WORKDIR /app

# Dependencies first, so editing source does not reinstall them.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY apps ./apps

USER bun
EXPOSE 8787

# Migrations run inside the server on start, so there is nothing to remember
# to do first. See apps/server/src/db/migrate.ts.
CMD ["bun", "run", "apps/server/src/index.ts"]
