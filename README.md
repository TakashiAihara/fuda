# fuda

A shared task queue between you and your coding agent.

Working with a coding agent in a terminal, the things that need an answer — a decision to make, a question to settle, a request to hand over — exist only as terminal output. They disappear when the session ends, when context is compacted, or when they scroll away.

fuda gives them somewhere to live. The agent writes them; you read and answer them in a browser; nothing has to be retained in your head or in scrollback.

## What it does

- Holds exchanges as items. One item is one exchange, with report, notice, question and request sections
- Sections that need an answer say so, and say how: free text, a choice, an approval, a review done elsewhere, or a request for the agent to pick up
- You answer in one screen. Choices are buttons, approval is one click
- Requests are not interruptions. The agent picks them up when it reaches a break
- Notifications fire only when something new needs your answer, batched, with at most one reminder

## Status

Early. An agent can write exchanges and read them back, through an HTTP API and through the `fuda` command. The browser screen, activity, pickup, MCP and notifications are not built yet.

- `docs/requirements.md` — what fuda is, decided
- `docs/design/01-implementation-plan.md` — how it gets built, and what is done so far
- `docs/glossary.md` — one word, one meaning

## Running it

```bash
docker compose up
```

That is the whole installation. PostgreSQL comes with it, migrations run on start, and the server is at <http://localhost:8787>.

An agent writes and reads through the command:

```bash
export FUDA_SENDER=session:01K6Ss     # who is writing. Required
fuda write < exchange.json            # or pipe it in
fuda list                             # waiting first, oldest first
fuda show <id>
```

There is no `fuda reply`, and that is the point: a section is answered by whoever it is addressed to, and most of them are addressed to you.

Nothing assumes a particular host or platform. Every value is configuration, and `.env.example` lists them; only the database connection has no default.

## Interfaces

- Agents use a CLI and MCP
- People use a browser
- Runs from a single compose invocation, with PostgreSQL included

## License

MIT
