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

Requirements are settled. Implementation has not started.

See `docs/requirements.md` for the specification.

## Interfaces

- Agents use a CLI and MCP
- People use a browser
- Runs from a single compose invocation, with PostgreSQL included

## License

MIT
