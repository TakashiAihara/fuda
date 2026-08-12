# fuda implementation design

Status: approved 2026-08-11. Step 1 of the delivery plan is built; steps 2 to 8 are not. Section 11 says which is which, and it is the thing to update as steps land.

Scope: how `docs/requirements.md` becomes running code. The requirements are settled and are not revisited. Where the requirements are silent, this document proposes an answer and marks it, so the decision is visible rather than buried in code.

Everything marked `DECIDE-n` was open when this was written. All nine are settled; section 12 records each outcome and the reasoning, including for the one that went against its own recommendation.

## 1. Shape of the system

Five deliverables, one process to run.

| Piece  | What it is                                                       | Runs where                |
| ------ | ---------------------------------------------------------------- | ------------------------- |
| core   | Schemas, types, state machines. No I/O                           | library                   |
| server | HTTP API, SSE stream, notification worker, serves the web bundle | container                 |
| web    | The one screen                                                   | browser, served by server |
| cli    | `fuda` — the agent's mouth and ears                              | agent's machine           |
| mcp    | The same operations as MCP tools                                 | agent's machine           |

```
agent ──cli───┐
              ├──HTTP──▶ server ──▶ PostgreSQL
agent ──mcp───┘            │
                           ├──SSE──▶ web (browser)
person ─browser────────────┘
                           └──▶ notification target (pluggable)
```

The server is the only thing that talks to PostgreSQL. `DECIDE-1` covers the alternative.

### Why the server owns the database

Three of the operations in the requirements are conditional updates that must not race: claiming a request so two sessions cannot take the same one, returning a stalled request to not started, and stamping a notification as sent so a batch is not delivered twice. Keeping them in one place means one implementation, one set of tests, and no requirement that every agent machine can reach the database port.

It also makes the agent's configuration a single URL instead of a connection string.

## 2. Data model

PostgreSQL. Settled axes are columns; section bodies and overflow are JSONB, per the requirements.

### items

| Column              | Type             | Notes                                                                        |
| ------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `id`                | uuid v7          | time-ordered, so the primary key sorts by creation                           |
| `summary`           | text             | one line, shown in the list — `DECIDE-2`                                     |
| `sender`            | text             | who wrote it. Required. Never verified                                       |
| `attribution`       | jsonb            | arbitrary labels, e.g. `{"session":"…","repository":"fuda","branch":"main"}` |
| `origin_item_id`    | uuid null        | the item this was raised from                                                |
| `origin_section_id` | uuid null        | the section this was raised from                                             |
| `created_at`        | timestamptz      |                                                                              |
| `read_at`           | timestamptz null | a mark, not a state                                                          |
| `closed_at`         | timestamptz null | the explicit closed flag; set means closed regardless of sections            |

`attribution` gets a GIN index. Filtering is `attribution @> '{"repository":"fuda"}'`.

### sections

| Column             | Type             | Notes                                                                                            |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------ |
| `id`               | uuid v7          |                                                                                                  |
| `item_id`          | uuid             | cascade delete                                                                                   |
| `position`         | int              | order within the item                                                                            |
| `kind`             | text             | `report` \| `notice` \| `question` \| `request`                                                  |
| `reply_form`       | text null        | `free_text` \| `choice` \| `approval` \| `external_tool` \| `pickup`; null means no reply needed |
| `body`             | jsonb            | the varying part: `{ "text": "…", "options": […], "link": "…" }`                                 |
| `state`            | text null        | null when `reply_form` is null; otherwise see below                                              |
| `unanswered_since` | timestamptz null | when it became unanswered — the list orders by this                                              |
| `settled_at`       | timestamptz null | when it reached answered or done                                                                 |
| `reply`            | jsonb null       | the answer                                                                                       |
| `answered_by`      | text null        | who replied. Required whenever `reply` is present                                                |
| `recipient`        | text null        | who owes the answer. Null means anyone                                                           |
| `claimed_by`       | text null        | the session that picked it up                                                                    |
| `claimed_at`       | timestamptz null |                                                                                                  |
| `notified_at`      | timestamptz null | batching                                                                                         |
| `reminded_at`      | timestamptz null | reminder cap                                                                                     |

### activity

| Column | Type | Notes |
|---|---|---|
| `id` | uuid v7 | |
| `sender` | text | who wrote the line. Required |
| `section_id` | uuid null | the request section this advances, when there is one |
| `text` | text | one line |
| `written_at` | timestamptz | also what the stale check reads |

Its own table, not a kind of section: written at a different rate, read in a different place, and deleted on a schedule of its own. Indexed by `(sender, written_at desc)`, which is how the screen reads it.

`sections.progress_at` does not exist. Writing a line *is* the movement, so the stale check reads the newest activity for that section instead of a column kept in parallel with it. One fact, one place.

Deletion is a sweep in the same worker that batches notifications: anything older than the retention window goes. A month of it is the most volatile thing fuda holds, and keeping it forever would make it most of the database.

`kind` and `reply_form` are `text` with a check constraint, not a PostgreSQL enum. The requirements call reply forms extensible, and altering a check constraint is a migration; altering an enum in use is a fight.

Multiple sections of the same kind in one item are allowed — two questions in one exchange happen. `DECIDE-3`.

### Section state

Which state machine applies is determined by `reply_form`, not by `kind`. This is an interpretation of the requirements and is marked `DECIDE-4`.

```
reply_form = free_text | choice | approval | external_tool
    unanswered ──reply(person)──▶ answered
    unanswered ◀──resume(person)── deferred
    unanswered ──defer(person)──▶ deferred

reply_form = pickup
    not_started ──claim(agent)──▶ in_progress ──finish(agent)──▶ done
    in_progress ──stale──▶ not_started

reply_form = null
    state is null. Nothing is owed
```

Who may advance a section follows its `recipient`, not what kind of actor is asking. A reply is refused unless its sender equals the recipient, or the recipient is null. `closed_at` is set by the person, or by the item's `sender` withdrawing what it raised.

None of this is authentication. The sender arrives as a claim and is compared, not checked, which stops an agent from settling what is waiting on the person by accident but not on purpose. There is nothing to check it against — the same would be true if the browser were the only entrance.

### Derived item state

An item is open while any section is unsettled, unless `closed_at` is set, which wins.

Settled means `answered`, `done`, or `state is null`. Deferred is not settled — the person postponed it, they did not finish it — so a deferred item stays open, sits below the unanswered group in the list, and is never reminded.

This is a view rather than a maintained column, because the ordering key is `min(unanswered_since)` across sections and that is an aggregate:

```sql
create view item_list as
select i.*,
       (i.closed_at is not null) as closed,
       min(s.unanswered_since) filter (where s.state = 'unanswered') as oldest_unanswered_at,
       count(*) filter (where s.state = 'unanswered') as unanswered_count,
       count(*) filter (where s.state = 'deferred')   as deferred_count,
       count(*) filter (where s.state in ('not_started','in_progress')) as open_request_count
from items i left join sections s on s.item_id = i.id
group by i.id;
```

List ordering: items with `unanswered_count > 0` first, `oldest_unanswered_at` ascending within that group; everything else after, newest first. Closed items are excluded unless explicitly asked for.

### Search

Closed items must stay searchable. Content will be largely Japanese, which `to_tsvector` does not segment without an extension, so the first cut uses `pg_trgm` with `ILIKE` over a maintained text column holding the item summary plus every section body's text. Both the extension and the index ship in the migration.

### Schema and migrations

Drizzle. The tables above are declared in TypeScript, `drizzle-kit generate` diffs them into numbered SQL files, and the server applies the pending ones on start. The requirements say the structure must remain changeable while in use, so the migration path is a first-class part of the product, not a build step.

Row types come from the schema declaration, so the repository layer is typed against the database instead of against hand-written row types that drift from it silently.

Two things drizzle-kit does not generate, hand-written into the migration file it produces:

- `create extension if not exists pg_trgm`, which the search index needs
- The check constraints on `kind`, `reply_form` and `state`. Whether the current drizzle-kit emits these is verified in step 2 rather than assumed; if it does, the hand-written version goes away

Everything else this schema needs is generated: the `item_list` view, the GIN index on `attribution`, and the trigram index with `gin_trgm_ops`. The claim path's `update … where … returning` and `select … for update skip locked` are both expressible directly, and anything awkward drops to `sql`.

## 3. HTTP API

JSON over HTTP. Everything the agent needs and everything the browser needs, no split. No authentication — out of scope by the requirements.

One set of endpoints. There is no browser half and no agent half — what an actor may do follows the recipient of the section it is acting on, so the same endpoint serves both.

| Method | Path                         | Effect                                                           |
| ------ | ---------------------------- | ---------------------------------------------------------------- |
| `GET`  | `/api/items`                 | list; filters `state`, `attribution`, `recipient`, `q`, `closed` |
| `GET`  | `/api/items/:id`             | item with sections                                               |
| `POST` | `/api/items`                 | write an item, and pick up in the same operation                 |
| `POST` | `/api/items/:id/read`        | set the read mark                                                |
| `POST` | `/api/items/:id/close`       | set the closed flag                                              |
| `POST` | `/api/sections/:id/reply`    | answer; body depends on the reply form                           |
| `POST` | `/api/sections/:id/defer`    | postpone                                                         |
| `POST` | `/api/sections/:id/resume`   | un-postpone                                                      |
| `POST` | `/api/pickup`                | pick up without writing — the minimum-interval path              |
| `POST` | `/api/activity` | add a line. Also the movement that keeps a taken request from going stale |
| `GET` | `/api/activity` | read it back, newest first, filtered by sender |
| `POST` | `/api/sections/:id/finish`   | request done                                                     |
| `GET`  | `/api/events`                | SSE; one event per change, so an open browser stays current      |

Every write carries a `sender`. The browser omits it and the server fills in the person's configured identity; an agent supplies its own. `reply`, `defer` and `resume` are refused when the sender is neither the section's recipient nor is the recipient null. `close` is refused unless the sender is the person or the item's own sender.

`POST /api/items` responds with the created item and `picked_up`: the request sections claimed by this write. The requirements make a write the definition of a break, and the write and the pickup one operation.

The web bundle is served from `/` by the same server. One origin, no CORS, one port to publish in compose.

## 4. CLI

One binary, `fuda`. It is also the MCP server — `fuda mcp` speaks stdio MCP. One artifact to install, one place where the operations are defined. `DECIDE-6`.

```
fuda write [--file item.json | -]      write an item; prints picked-up requests
fuda list [--state …] [--attribution k=v] [--recipient …] [--search …]
fuda show <id>
fuda reply <section-id> [--file reply.json | -]   answer what is addressed to me
fuda defer <section-id>                postpone what is addressed to me
fuda resume <section-id>               un-postpone it
fuda withdraw <item-id>                close an item I raised
fuda pickup [--if-stale] [--recipient …]   pick up without writing
fuda activity <text> [--section <id>]     add a line; also the movement on a taken request
fuda finish <section-id> [--file report.json]
fuda mcp                               serve MCP over stdio
```

The sender comes from configuration, so it is not typed on every invocation and cannot be forgotten. `reply`, `defer` and `resume` reach only sections addressed to that sender or to nobody; the server refuses the rest, and the CLI reports the refusal rather than swallowing it.

Item input is JSON on stdin or in a file. Section bodies are markdown and can be long; flags are the wrong shape for that.

```json
{
  "summary": "v3 migration: two questions before I continue",
  "sender": "session:01K6Ss…",
  "attribution": { "session": "01K6Ss…", "repository": "fuda", "branch": "main" },
  "sections": [
    { "kind": "report", "body": { "text": "Moved the reader…" } },
    {
      "kind": "question",
      "reply_form": "choice",
      "recipient": "person",
      "body": {
        "text": "Which name?",
        "options": [
          { "value": "a", "label": "pickup" },
          { "value": "b", "label": "claim" }
        ]
      }
    },
    {
      "kind": "request",
      "reply_form": "pickup",
      "recipient": null,
      "body": { "text": "Check the other file too" }
    }
  ]
}
```

`--if-stale` returns nothing unless the configured minimum interval has passed since this session last picked up. The interval is enforced server-side, since that is where "last picked up" is recorded.

What calls `fuda pickup --if-stale` periodically is outside the tool: in Claude Code a hook does it, elsewhere something else does. fuda does not depend on any of them. `DECIDE-7`.

There is no `fuda close` for someone else's item. Withdrawal reaches only what this sender raised, which is the whole of an agent's business with the closed flag.

## 5. MCP

The same operations, named the same, as tools: `fuda_write`, `fuda_list`, `fuda_show`, `fuda_reply`, `fuda_defer`, `fuda_resume`, `fuda_withdraw`, `fuda_pickup`, `fuda_activity`, `fuda_finish`. Arguments are the JSON above, which is what MCP wants anyway. Tool descriptions say that a reply reaches only what is addressed to this sender, so the model does not discover it by being refused.

Configuration is two environment variables: the server URL and the sender.

## 6. Web

One screen. List on the left, selected item on the right. React, Vite, TanStack Query, SSE for push. Built to static files and served by the server.

- Detail pane renders section bodies as markdown, read-only, no raw HTML
- Choices are buttons, approval is one click plus an optional note, free text is a field, external tool is a link out plus a one-click "done"
- Next to the reply field, a control raises a separate item. It records `origin_item_id` and `origin_section_id`, which is why those columns exist from the start
- Filters: attribution, state and recipient, defaulting to what is waiting on the person or on nobody. Nothing else — filtering by section kind would cut items in half
- The sender is never typed. The server stamps the person's configured identity on everything the browser sends
- Read marks are set when the detail pane opens an item, and shown in the list
- No routing between screens. Selection is a query parameter so a link to an item works

The list does not rank or suggest. Ordering and filters are the whole feature.

## 7. Notifications

A worker inside the server, on a timer.

1. Find sections that became unanswered, whose recipient is the person or is null, and have `notified_at` null. If any, compose one message for the batch, deliver it, stamp them. The window is configuration. What is addressed to an agent is never pushed — an agent pulls at a break
2. Find sections unanswered longer than the reminder threshold with `reminded_at` null and state not `deferred`. Send one reminder, stamp them. At most one, ever
3. Nothing fires for reply-free reports and notices, or for a finished request. A finished request appears as a report

Composition and delivery are separate. Delivery is an interface with one method; the targets that ship are `none` (default) and `webhook` (POST JSON to a configured URL). `DECIDE-8`.

Message content is configurable: `count` (a count and a link, the default, because the target may be a shared public instance) or `summary` (adds item summaries).

## 8. Pickup and stalling

- A write claims: unaddressed requests, plus requests addressed to this sender. `not_started` only. A single `UPDATE … WHERE state = 'not_started' … RETURNING`, so two sessions cannot take the same one
- The claim records `claimed_by` and `claimed_at`, and writes an activity line saying what was taken
- `POST /api/activity` adds a line. Sent while working, it is also the movement, so there is no separate heartbeat to forget
- The worker returns `in_progress` sections whose newest activity is older than the stale threshold to `not_started`, clearing `claimed_by`. Configuration, default measured in tens of minutes
- The response to a write lists what was claimed, because the requirements say pickup is never silent: the next item the agent writes says what it took

## 9. Configuration

Environment variables, all with defaults except the database URL. Nothing assumes a host, a platform, or the author's machine.

| Variable                     | Default                 | Meaning                                                                               |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `FUDA_DATABASE_URL`          | —                       | required                                                                              |
| `FUDA_PORT`                  | `8787`                  | server port                                                                           |
| `FUDA_BASE_URL`              | `http://localhost:8787` | the link put in notifications                                                         |
| `FUDA_PERSON_IDENTITY`       | `person`                | what the server stamps on anything the browser sends. An authenticated username later |
| `FUDA_NOTIFY_TARGET`         | `none`                  | `none` \| `webhook`                                                                   |
| `FUDA_NOTIFY_WEBHOOK_URL`    | —                       | required when target is webhook                                                       |
| `FUDA_NOTIFY_CONTENT`        | `count`                 | `count` \| `summary`                                                                  |
| `FUDA_NOTIFY_BATCH_WINDOW`   | `60s`                   | batching window                                                                       |
| `FUDA_NOTIFY_REMINDER_AFTER` | `4h`                    | one reminder after this                                                               |
| `FUDA_PICKUP_MIN_INTERVAL`   | `30m`                   | `--if-stale` threshold                                                                |
| `FUDA_PICKUP_STALE_AFTER`    | `30m`                   | returns in-progress to not started                                                    |
| `FUDA_ACTIVITY_RETENTION` | `30d` | how long activity is kept before the sweep takes it |
| `FUDA_URL`                   | `http://localhost:8787` | the cli and mcp side                                                                  |
| `FUDA_SENDER`                | —                       | required by the cli and mcp. Who this agent is                                        |

`compose.yaml` starts PostgreSQL with a named volume and the server, and publishes one port. `docker compose up` is the whole installation.

## 10. Testing

- Unit, on core: the state machines, the derivation of item state, notification eligibility, claim eligibility. No database
- Integration, on the repository layer: against real PostgreSQL from compose. The conditional updates are the point — two concurrent claims, one wins
- End to end: drive the real HTTP entry point. Write through the API the CLI uses, answer through the API the browser uses, and read the result. No synthetic rows inserted mid-scenario to skip a step — the entry points are the test
- Browser end to end with Playwright once the web screen exists

Any change to behaviour comes with a test in the same change. A behaviour change that breaks no test is a gap in coverage.

## 11. Delivery

Each step leaves the tree working and is one draft PR.

| #   | Contents                                                                                                                                                                         | Working means                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1 ✅ | Workspace, TypeScript, lint, `compose.yaml`, PostgreSQL, migration runner, `docs/glossary.md`, CI                                                                                | `docker compose up` is healthy                               |
| 2   | core schemas and state machines, tables, repository, `POST`/`GET` items                                                                                                          | an item round-trips through the API, with tests              |
| 3   | `fuda write`, `list`, `show`                                                                                                                                                     | the agent can store and read items                           |
| 4   | Web: list, detail, reply, defer, close, read marks, raise-a-separate-item, SSE                                                                                                   | the loop closes without the terminal                         |
| 4b | Activity: the table, `POST`/`GET /api/activity`, `fuda activity`, the third region of the screen and its toasts | the work is watchable without the terminal |
| 5   | `fuda mcp`                                                                                                                                                                       | agents on MCP have the same reach                            |
| 6   | Pickup: claim on write, `--if-stale`, finish, stale return. Agent-side answering: `reply`, `defer`, `resume`, `withdraw`, refused when the sender is not the recipient | requests flow both ways, and agent to agent works end to end |
| 7   | Notifications: batching, one reminder, `none` and `webhook` targets. The activity sweep rides the same worker                                                                                                              | new unanswered items announce themselves                     |
| 8   | Search over closed items, README and configuration reference                                                                                                                     | publishable                                                  |

Step 1 is built and on `main`. What it leaves standing: `docker compose up` brings up PostgreSQL and a server that migrates itself and answers `/health`, with the checks in section 10 running in CI.

Step 4b lands after the screen exists, because activity with nowhere to show it is a table nobody reads.

Step 4 is where fuda first does its job. Steps 1 to 3 are the shortest path to it.

## 12. Decisions

Answered 2026-08-11.

| ID       | Outcome                                                       |
| -------- | ------------------------------------------------------------- |
| DECIDE-1 | Through the server                                            |
| DECIDE-2 | An explicit `summary`                                         |
| DECIDE-3 | Several sections of one kind are allowed                      |
| DECIDE-4 | The state machine is chosen by `reply_form`                   |
| DECIDE-5 | Drizzle, against the recommendation below                     |
| DECIDE-6 | `fuda mcp`, a subcommand                                      |
| DECIDE-7 | `fuda pickup --if-stale`, with the hook shipped as an example |
| DECIDE-8 | `none` and `webhook`                                          |
| DECIDE-9 | English                                                       |

The reasoning behind each is kept below, including for the one that went the other way.

### DECIDE-1 — Do the CLI and MCP go through the server, or straight to PostgreSQL?

- (a) Through the server, recommended. One implementation of the racy operations, agents configure one URL, the database port never has to leave the compose network
- (b) Straight to PostgreSQL. The CLI works with no server running, but the conditional updates, the pickup interval, and the notification stamps exist twice, and every agent machine needs database credentials

### DECIDE-2 — Does an item carry a one-line summary?

The requirements do not mention one, and the list needs something to show per item.

- (a) An explicit `summary`, written by the agent, required. Recommended: the list exists so nothing is lost, and it is only scannable if each row says what it is. The agent already writes a heading
- (b) Derive it from the first line of the leading section. Nothing new in the schema, but it breaks the moment a section starts with a table or a code fence
- (c) No summary. The list shows section kinds and the first characters of the leading body

This introduces a name that is not in the requirements, which is why it is a question and not a decision.

### DECIDE-3 — May one item hold several sections of the same kind?

- (a) Yes, a list of sections with a position. Recommended: two questions in one exchange is ordinary, and the requirements say prohibitions push the agent into workarounds
- (b) At most one per kind, four sections maximum

### DECIDE-4 — Is the state machine chosen by `reply_form` or by `kind`?

The requirements say sections with a reply form are unanswered or answered, and request sections are not started, in progress, or done. Since combinations are unrestricted, the two rules can be read as overlapping.

- (a) By `reply_form`. Recommended: `pickup` gets not started / in progress / done, every other reply form gets unanswered / deferred / answered, no reply form gets no state. Total and non-overlapping
- (b) By `kind`, with requests carrying both machines

### DECIDE-5 — Migrations: plain SQL, or a schema toolkit? — Drizzle

- (a) Numbered SQL files and a runner. Originally recommended on the grounds that the conditional updates read better as hand-written SQL
- (b) Drizzle. Chosen

The original recommendation overstated its own case. Drizzle does not stand between the code and any statement: the claim path's `update … returning` and `select … for update skip locked` are first-class, and `sql` takes anything else. What (a) actually buys is independence from a library version and migration files no generator has an opinion about; what it costs is hand-written row types that the database can silently outgrow, which is the more expensive of the two given that the requirements demand the schema stay changeable while in use.

The limits are known and small: `create extension` and possibly the check constraints are hand-added to the generated migration, per "Schema and migrations" above.

### DECIDE-6 — Is MCP a subcommand of the CLI or a separate binary? — `fuda mcp`

The operations live in a shared package either way, so this is not a question about code structure or drift. What actually differs:

- (a) `fuda mcp`. One thing to install and one version to keep straight. MCP configuration is `command: fuda, args: ["mcp"]`. The CLI binary carries the MCP SDK even for someone who only ever uses the CLI. One real hazard: a stdio MCP server may put nothing on stdout but protocol frames, so every log and warning in the shared paths has to go to stderr — a discipline that is easy to break in a codebase whose other half prints to stdout for a living
- (b) A separate `fuda-mcp`. Two artifacts to build, release and keep at the same version, in exchange for stdout belonging unambiguously to each

Chosen: (a). The stdout hazard is handled rather than tolerated — everything that reports goes through one writer that takes a stream, the CLI gives it stdout, `fuda mcp` gives it stderr, and a test asserts that a session of `fuda mcp` puts nothing but protocol frames on stdout.

### DECIDE-7 — What triggers the minimum-interval pickup?

The requirements set the rule and not the trigger. fuda cannot wake an agent up.

- (a) fuda exposes `fuda pickup --if-stale` and documents integrations. A Claude Code hook is one, and it ships as an example, not as a dependency. Recommended
- (b) The CLI checks on every invocation and prints anything picked up. Fewer moving parts, but nothing happens if the agent runs no fuda command for an hour, which is exactly the gap being closed

### DECIDE-8 — Which notification targets ship first?

- (a) `none` and `webhook`. Recommended: a webhook reaches Slack, Discord and a self-hosted receiver without fuda knowing about any of them
- (b) Add a named Slack target as well
- (c) `none` only for now, with the interface in place

### DECIDE-9 — What language are the documents in this repository written in?

`docs/requirements.md` and `README.md` are in English. This document follows them. Confirm that design documents stay in English, or say the word and it is rewritten in Japanese.

## 13. Names to approve

Names taken from the requirements and used unchanged: item, section, report, notice, question, request, reply form, free text, choice, approval, external tool, pickup, attribution, sender, recipient, withdraw, deferred, closed.

Names introduced here, needing approval:

| Name                                  | Where      | What it means                                                 |
| ------------------------------------- | ---------- | ------------------------------------------------------------- |
| `summary`                             | items      | the one line the list shows (`DECIDE-2`)                      |
| `settled`                             | derivation | a section that owes nothing: answered, done, or reply-free    |
| `claimed_by`, `claimed_at`            | sections   | which session picked a request up, and when                   |
| `written_at` | activity | when a line was written; the stale check reads the newest |
| `unanswered_since`                    | sections   | the requirements' "time a section became unanswered"          |
| `answered_by`                         | sections   | who replied. Present whenever a reply is                      |
| `origin_item_id`, `origin_section_id` | items      | the requirements' "which item and section it was raised from" |
| `finish`                              | cli, api   | the agent declaring a request done                            |
| `activity` | cli, api, storage | a line written as work happens; not an item, never notified |

`docs/glossary.md` lands in step 1 and carries these, along with the words that collide and must never be used bare: _state_ (a section's versus an item's derived one), _report_ (a section kind versus the completion of a request), _session_ (the agent's versus anything HTTP), _request_ (a section kind versus an HTTP request), _done_ (a request's state versus finishing anything at all), _open_ (an unsettled item versus opening a link).

One collision was removed rather than documented. A request's `target` and a notification's target were the same word for different things; renaming the first to `recipient` leaves _target_ meaning a notification's destination and nothing else.

## 14. Amendment, 2026-08-12

The requirements gained a direction model after this plan was written, and the plan above already reflects it. In short: a `sender` is required on everything written, a `recipient` is optional on every section, both come from one set of identities, and who may advance a section follows its recipient rather than what kind of actor is acting. Agent to agent falls out of that with no special case.

What changed here as a result: `sender` and `answered_by` on the schema, `target` renamed to `recipient`, one set of endpoints instead of a person's half and an agent's half, `reply` / `defer` / `resume` / `withdraw` in the CLI and MCP, notifications restricted to what waits on the person or on nobody, `recipient` added to the filters, and `FUDA_PERSON_IDENTITY` and `FUDA_SENDER` in the configuration.

The sender is recorded and never verified. Comparing it to the recipient stops accidents, not impersonation, and no arrangement of entrances would change that while there is nothing to check a name against.
