# Glossary

One word, one meaning. Every entry says where the thing actually exists — a table, a column, an endpoint — so a claim about it can be checked instead of believed.

Words are listed here before they are implemented. Fixing a name after the code exists is too late.

## What belongs in fuda at all

fuda holds what someone wrote and someone else owes an answer to. It does not hold what a machine can observe.

The test: delete it, observe the world again, and see whether the same thing comes back. A branch name, a dirty working tree, whether a process is alive, how long it has been running — all of these come back, and none of them belong here. A question, a decision, a request, a report — none of these come back, because they are statements someone made.

## Words that collide

These have two plausible meanings. Never write them bare.

| Word | The two meanings | Rule |
|---|---|---|
| target | the **request target** (`sections.target`), and the **notification target** (`FUDA_NOTIFY_TARGET`) | always qualify. Bare "target" is a bug report waiting to happen |
| state | a **section's state** (`sections.state`), and an **item's state**, which is derived and stored nowhere | say "section state" or "item state (derived)" |
| report | the **section kind** `report`, and the completion of a request, which *appears as* a report | the kind is `report`. In prose about a finished request, say "completion report" |
| request | the **section kind** `request`, and an HTTP request | say "request section" or "HTTP request" |
| session | the **agent's session**, recorded in `items.attribution` and `sections.claimed_by` | fuda has no logins and no HTTP sessions, so the word is reserved for the agent's |
| done | the **request state** `done` | only requests are done. A reply-form section is *answered*; an item is *closed* |
| open | an **item that is not settled**, and opening a link | say "open item" |

## The words

### Structure

| Word | Where it exists | Meaning |
|---|---|---|
| item | `items` | one exchange. The unit the list shows and the detail pane opens |
| section | `sections` | one part of an exchange. An item holds several, in `position` order, and several may share a kind |
| kind | `sections.kind` | what a section is: `report`, `notice`, `question`, `request` |
| summary | `items.summary` | the one line the list shows. Written by whoever writes the item |
| body | `sections.body` | the varying part of a section: its text, and whatever its reply form needs |
| origin | `items.origin_item_id`, `items.origin_section_id` | the item and section this one was raised from, when it was raised beside a reply |

### Answering

| Word | Where it exists | Meaning |
|---|---|---|
| reply form | `sections.reply_form` | how a section is answered: `free_text`, `choice`, `approval`, `external_tool`, `pickup`. Null means no answer is owed |
| reply | `sections.reply` | the answer itself |
| unanswered | `sections.state` | an answer is owed and nobody has postponed it |
| answered | `sections.state` | the answer arrived |
| deferred | `sections.state` | postponed on purpose. Not a kind of unanswered: unanswered means someone is waiting, deferred means someone decided not to answer yet. Never reminded |
| unanswered since | `sections.unanswered_since` | when the section started owing an answer. The list orders by this, not by creation time |
| settled | derived, stored nowhere | a section that owes nothing: `answered`, `done`, or with no reply form. Deferred is **not** settled |
| closed | `items.closed_at` | the item is done with, whatever its sections say. Set explicitly; it wins over derivation |
| read | `items.read_at` | a mark, not a state. It never decides whether an item is open |

### Requests

| Word | Where it exists | Meaning |
|---|---|---|
| pickup | `sections.reply_form` value | the reply form meaning "take this and start". The name of the form |
| claim | `sections.claimed_by`, `sections.claimed_at` | the act of taking a request, and who took it. Not a reply form — do not use it as one |
| request target | `sections.target` | who a request is for. Absent means anyone may take it |
| not started / in progress / done | `sections.state` | the request's states |
| progress | `sections.progress_at` | the last sign of movement. Used to tell a live request from an abandoned one |
| stale | derived from `progress_at` | in progress with no movement for long enough. A stale request returns to `not started` |
| break | not stored | the moment an agent writes an item. Writing is itself the claim that a unit of work finished, so it is when requests get picked up |

### Attribution

| Word | Where it exists | Meaning |
|---|---|---|
| attribution | `items.attribution` | where an item came from, as arbitrary labels. Not fixed columns: one agent supplies a session, a repository and a branch, another supplies whatever identifies it |

Attribution is the join key to anything outside fuda. Whatever identifies a machine, a directory or a session elsewhere can be put in here as a label, and fuda stays ignorant of what it means.

### Notifications

| Word | Where it exists | Meaning |
|---|---|---|
| notification | `sections.notified_at` | fired when something new becomes unanswered. Never for a reply-free section, never for a finished request |
| batch | `FUDA_NOTIFY_BATCH_WINDOW` | one message for everything that became unanswered inside a window |
| reminder | `sections.reminded_at` | one, at most, ever, for a long-unanswered section. Never for a deferred one |
| notification target | `FUDA_NOTIFY_TARGET` | where a notification is delivered. Pluggable, and unrelated to a request target |

### Leaving

| Word | Where it exists | Meaning |
|---|---|---|
| promotion | not stored | moving a conclusion out of fuda into wherever it is kept for good. Proposed, then approved. Nothing leaves automatically |
| retention | — | closed items are not deleted. They leave the list and stay searchable, indefinitely |
