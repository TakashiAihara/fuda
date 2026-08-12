# fuda requirements

A shared task queue between a person and their coding agent.

This document is the decided specification. The deliberation that produced it (options considered, rejected alternatives, and why) is kept outside this repository; only the conclusions and their reasons live here.

## Problem

Working with a coding agent in a terminal has two costs. One is that the terminal is hard to read. The other is the round trips themselves: switching between the terminal and a browser is a cost that grows with every exchange.

The second cost is the one this project addresses. Reports, decisions, questions and requests that need an answer currently exist only as terminal output. They disappear when the session ends, when context is compacted, when history is rewound, or simply when they scroll away. There is no place to put them.

An inline markdown review tool solves a neighbouring problem — comments on a document — but not this one. A request like "also check that other file", raised while reviewing a design document, has nothing to do with the document on screen.

## What fuda is

- The surface where a person and an agent exchange anything that needs an answer or needs to survive
- Storage that does not evaporate, and a place where replies are completed
- Temporary retention for the exchange itself. fuda is not the system of record for conclusions; those get promoted elsewhere
- Closing an item must be possible without returning to the terminal

## Structure

One item is one exchange. It mirrors how an agent already structures a written reply.

- An item holds sections: report, notice, question, request. Sections may be absent. A single section may be much longer than the rest
- Each section optionally carries a reply form. No reply form means no reply is needed

Reply forms, extensible:

| Reply form    | How it is answered                    |
| ------------- | ------------------------------------- |
| free text     | written answer                        |
| choice        | pick one of the offered options       |
| approval      | confirm whether to proceed            |
| external tool | done elsewhere, then closed on return |
| pickup        | the agent pulls it and starts work    |

Combinations are not restricted by the schema. Some combinations do not occur in practice — a report does not carry choices — but encoding prohibitions pushes the agent into workarounds when an exception appears. Whether a reply form is attached is decided per section, at the time of writing.

## Direction and pickup

Every item records who wrote it, and every section may record who it is for. Both are drawn from one set of identities: the person, and whatever identifies an agent.

- The sender is required on anything written, including a reply. An agent names itself; the browser has it filled in on the person's behalf
- The recipient sits on the section and is optional. Absent means anyone

Recording a sender is not authenticating one. There are no logins here, so a sender is a claim; the server compares it against the recipient to prevent accidents, not to prove anything. A fuda whose only entrance was a browser would be no different, having nothing to check a name against either.

Direction is the pair, not the kind of actor involved, so agent to agent is as ordinary as the rest:

- Agent to person: decisions, questions, choices. The writer cannot proceed until answered
- Person to agent: requests. Not delivered as an interruption. Picked up at a break
- Agent to agent: either of the above, between two sessions

A break is defined as the moment the agent writes an item to fuda. Writing an item is itself the statement that a unit of work finished, so no separate definition is needed, and the write and the pickup happen in one operation.

This leaves a gap: during long stretches with no writes, nothing gets picked up. A minimum interval closes it — if enough time has passed since the last pickup, the agent picks up anyway. Turn count is not used, because it does not correlate with how much work happened.

Picked-up requests are not started silently. The next item the agent writes says what was picked up, and work starts after that. The agent decides the order; the person can correct it in a reply.

## Activity

Items are written at breaks. Between two breaks nothing is visible, and the place to find out what is happening is the terminal — which is the thing this project exists to remove. Answering everything without the terminal is not enough if watching still requires it.

So an agent also writes activity: single lines, as the work happens.

- Activity is not items. It never joins the list, never asks for an answer, and is never sent to a notification target. Reply-free lines accumulating in the list is precisely what the list's ordering exists to prevent
- A line belongs to its sender, and to the request section it advances when there is one
- Writing a line is the movement that keeps a taken request from going stale. There is no second signal to send and forget
- Kept for a month. It is the most volatile thing fuda holds, and keeping it indefinitely would make it most of the database. A month outlasts a long-running session and still leaves something for a later review to read
- The person can raise a request while watching. It is picked up at the next break, so watching never turns into interrupting

## State

State lives on sections. The item's state is derived: an item is open while any section is unsettled. Settled means answered, done, or carrying no reply form. Deferred is not settled — postponing is not finishing — so an item with nothing but deferred sections stays open, sits below the unanswered ones, and is never reminded about. The item additionally carries a single closed flag, which wins when set — this keeps derivation as the default while still allowing an item to be dismissed with sections outstanding.

- Sections with a reply form: unanswered, answered
- Request sections: not started, in progress, done
- Deferred is a state of its own, not a variety of unanswered. Unanswered means the agent is waiting; deferred means the person chose to postpone. Without the distinction the agent cannot tell whether to keep waiting, and reminders cannot be suppressed for the deferred case
- Read is not a state. Making it one leaves every reply-free report piling up as unread, which buries the things that actually need a reply. Read belongs in the list as a mark, not in the state machine

State only advances through the action of the actor who owns it, and ownership follows the recipient rather than the kind of actor.

| Transition                         | Advanced by                                            | Trigger              |
| ---------------------------------- | ------------------------------------------------------ | -------------------- |
| unanswered to answered             | the recipient                                          | replied              |
| unanswered to deferred, and back   | the recipient                                          | postponed, resumed   |
| not started to in progress to done | whoever took it                                        | picked up, finished  |
| item closes (derived)              | nobody                                                 | all sections settled |
| item closes (explicit)             | the person, or the sender withdrawing what they raised | closed flag set      |

Nobody settles what was addressed to someone else. An agent does not answer what is waiting on the person, and the person does not mark an agent's request done. An unaddressed section may be answered by anyone, which is what makes it unaddressed.

The sender may withdraw an item it raised, because asking a question and then finding the answer yourself is ordinary, and leaving it standing wastes the recipient's attention. Withdrawal is the same closed flag; nothing else distinguishes it.

## Scope and attribution

- Every item records where it came from. Attribution cannot be backfilled, so it is recorded from the start
- Attribution is a set of arbitrary labels rather than fixed columns. A Claude Code session supplies session, repository and branch; another agent supplies whatever identifies it
- The sender is not one of those labels. It is required and single, which a set of optional labels cannot express, and it is the counterpart of the recipient. Attribution stays what it is: the axis the list filters on and the join to anything outside
- The default view spans everything, with attribution available as a filter
- Any section may carry a recipient. Unaddressed sections may be answered, or picked up, by anyone
- Picking up records which session took it and moves the section to in progress. A request left in progress without movement returns to not started. Since the session that took it is recorded, this can stay simple

## Closing

Closed items are not deleted. Temporary retention means fuda is not the system of record; it does not mean the history is thrown away.

- Closed items leave the list but remain searchable
- On closing, conclusions worth keeping are promoted out of fuda. The agent proposes what to promote; the person approves. Nothing is written out automatically
- Retention is indefinite for now

## Notifications

- Fired only when something new becomes unanswered. Reply-free reports and notices are not announced, and neither is a completed request — completion appears as a report
- Only what is waiting on the person, or on nobody, is announced. What is addressed to an agent is pulled at a break, not pushed
- Batched over a short window into one message. Firing per item floods when several agent sessions run in parallel
- One reminder at most for a long-unanswered item. Deferred items are never reminded
- How much content a notification carries is configurable. The default is a count and a link only, because the notification service may be a shared public instance
- The notification target is pluggable. Composition and delivery are separated so further targets can be added

## Interface

- The agent reads, writes and replies through a CLI and through MCP. It replies only to what is addressed to it or to nobody
- The person uses a browser. Viewing, choosing and replying all complete there, and the sender is filled in rather than typed

One screen: a list, the selected item, and the activity arriving. Navigation between screens is itself a round trip, and round trips are what this project exists to remove.

- Replies happen inside the detail pane. Choices are buttons, approval is one click, free text is a field
- Next to the reply field is a way to raise a separate item, so an unrelated thought can be captured without leaving
- An external tool opens by link, not embedded. On return, one click marks the section answered
- Activity arrives twice over: as a toast that passes, and into a region that keeps it. A toast alone would make it unreviewable, and being able to look back at it is most of the reason it is kept at all

A toast is not a notification. Notifications leave the browser for a pluggable target and fire only when something new becomes unanswered; a toast is the open screen showing what just arrived. Activity produces toasts and never notifications, or a month of it would arrive on someone's phone.

The list puts unanswered items first, oldest first within that group, because the purpose is to stop things from being lost. Who a section is addressed to does not affect ordering; a recipient exists to say whose answer is owed and to stop two sessions from taking the same request, which is a different concern. Filters are attribution, state and recipient. The person's screen defaults to what is waiting on them or on nobody. Filtering by section kind is deliberately absent — an item is a group of sections, so filtering by kind would cut items in half.

The list does not suggest what to do next. The core of this project is not losing what needs a reply, which ordering and filtering already deliver.

## Recorded because the interface asks for it

The interface can be changed later. What the interface requires to be recorded cannot be reconstructed later, so it is in the schema from the start.

- Which item and section an item was raised from, for items created through the raise-a-separate-item path
- The time a section became unanswered, since ordering is by that and not by creation time
- The link an external tool section points at
- When a notification was last sent, needed both for batching and for capping reminders
- Which sender, and which request section, each activity line came from. Neither can be worked out afterwards from the line's text

## Storage

PostgreSQL with JSONB. The settled axes — section kind, state, sender, recipient, attribution — are columns; section bodies and overflow are JSON. Activity is its own table rather than a kind of section: it is written at a different rate, read in a different place, and thrown away on a schedule of its own.

The reason for not going fully schemaless: only the section bodies vary. Making the settled axes loose as well would push their consistency into the application, and the operations that matter here (returning a stalled request, preventing two sessions from taking the same one) are conditional updates over state and attribution.

The connection is supplied by configuration. Nothing assumes a particular host or platform.

## Distribution

Runs from a single compose invocation. Requiring PostgreSQL is acceptable because compose ships it.

## Out of scope

- Authentication and multi-tenancy. fuda is published as open source; it is not operated as a hosted service. A sender is recorded, never verified
- Structuring free text into items automatically
- Suggesting which item to handle next

Both of the latter belong to a later stage, where the agent takes a larger planning role.

## Constraints

- Items do not share a shape. Some carry no report, no notice and no question; some are almost entirely one long section
- The structure cannot be settled completely up front, and must remain changeable while in use
- Nothing assumes the author's own environment. Environment-specific values are configuration

## Revisions

- 2026-08-12 — Activity added. An agent writes single lines as work happens, so the terminal is not the only place to watch from. Activity is not items and never notifies; writing a line is also the movement that keeps a taken request from going stale; it is kept for a month. The screen gains a third region for it, and a toast is named as distinct from a notification.

- 2026-08-12 — Direction became a pair of identities. A sender is required on everything written, a recipient is optional on every section, and both come from one set, so agent to agent needs no special case. State ownership moved from the kind of actor to the recipient; the person may still be the only one who dismisses an item, joined by a sender withdrawing what they raised. A request's `target` became a section's `recipient`, leaving `target` to mean a notification's destination and nothing else. Replying joined the CLI and MCP, which previously had no way to answer at all.
