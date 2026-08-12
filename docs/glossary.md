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
| state | a **section's state** (`sections.state`), and an **item's state**, which is derived and stored nowhere | say "section state" or "item state (derived)" |
| report | the **section kind** `report`, and the completion of a request, which *appears as* a report | the kind is `report`. In prose about a finished request, say "completion report" |
| request | the **section kind** `request`, and an HTTP request | say "request section" or "HTTP request" |
| session | the **agent's session**, recorded in `items.attribution` and `sections.claimed_by` | fuda has no logins and no HTTP sessions, so the word is reserved for the agent's |
| done | the **request state** `done` | only requests are done. A reply-form section is *answered*; an item is *closed* |
| open | an **item that is not settled**, and opening a link | say "open item" |

One collision used to be here and was removed instead of documented. A request's target and a notification's target were one word for two things; the first became the **recipient**, so *target* now means a notification's destination and nothing else. Renaming beats a rule nobody remembers at the point of writing.

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
| write | `POST /api/items` | to create an item. An agent writing one is also a break, so the word carries more than it looks |
| raise | `POST /api/items` with an origin | to create an item beside a reply, when the thought has nothing to do with what is on screen. Recorded as `origin`, because it cannot be reconstructed afterwards |

### Section kinds

The four values of `sections.kind`. A section is exactly one of them, and an item may hold several of the same.

| Kind | Meaning |
|---|---|
| report | what happened. Written after the fact, and the form a finished request comes back in |
| notice | something worth knowing that changes nothing on its own |
| question | something the writer cannot decide alone. Carries a reply form, otherwise it is not a question |
| request | work handed over. Carries the `pickup` reply form when it is meant to be taken |

Nothing in the schema stops a kind from carrying any reply form. Some combinations do not occur in practice; encoding the prohibition would only push a workaround when the exception shows up.

### Direction

Who wrote a thing, and who owes an answer for it. One set of identities covers both, so person to agent, agent to person and agent to agent are the same mechanism.

| Word | Where it exists | Meaning |
|---|---|---|
| identity | `items.sender`, `sections.recipient` and friends | a name that means the person, or means one agent. There is exactly one person, since multi-tenancy is out of scope |
| sender | `items.sender`, `sections.answered_by`, `sections.claimed_by` | who wrote, replied or took. Required. An agent names itself; the browser has it filled in |
| recipient | `sections.recipient` | who owes the answer. Optional, and absent means anyone — which is what lets an untargeted request be taken by whoever reaches it first |
| withdraw | `items.closed_at`, set by the item's sender | closing what you raised yourself, because you found the answer. The same flag the person sets; only who set it differs |

A sender is **recorded, never verified**. There are no logins, so it is a claim. Comparing it against the recipient prevents accidents, not impersonation, and nothing about having fewer entrances would change that — a browser has no name to check either.

### Answering

| Word | Where it exists | Meaning |
|---|---|---|
| reply form | `sections.reply_form` | how a section is answered. Null means no answer is owed — that, and not the kind, is what makes a section reply-free |
| reply | `sections.reply` | the answer itself |
| unanswered | `sections.state` | an answer is owed and nobody has postponed it |
| answered | `sections.state` | the answer arrived |
| deferred | `sections.state` | postponed on purpose. Not a kind of unanswered: unanswered means someone is waiting, deferred means someone decided not to answer yet. Never reminded |
| unanswered since | `sections.unanswered_since` | when the section started owing an answer. The list orders by this, not by creation time |
| settled | derived, stored nowhere | a section that owes nothing: `answered`, `done`, or with no reply form. Deferred is **not** settled |
| closed | `items.closed_at` | the item is done with, whatever its sections say. Set explicitly; it wins over derivation |
| read | `items.read_at` | a mark, not a state. It never decides whether an item is open |

### Reply forms

The values of `sections.reply_form`. The list is meant to grow, which is why it is a checked text column and not a database enum.

| Reply form | How it is answered | What the body carries |
|---|---|---|
| free text | a written answer | — |
| choice | one of the offered options is picked | `options`, each an option value and its label |
| approval | one click saying whether to proceed | — |
| external tool | the work happens elsewhere, then one click on return | `link`, the address it points at |
| pickup | it is taken and started, rather than answered | — |

| Word | Where it exists | Meaning |
|---|---|---|
| option | `sections.body.options` | one of the choices offered by a `choice` section. The reply records which one |
| decision | `sections.reply` | what an `approval` section came back with: proceed or not |
| link | `sections.body.link` | where an `external_tool` section sends you. Recorded because the interface needs it and it cannot be reconstructed |

### Requests

| Word | Where it exists | Meaning |
|---|---|---|
| pickup | `sections.reply_form` value | the reply form meaning "take this and start". The name of the form |
| claim | `sections.claimed_by`, `sections.claimed_at` | the act of taking a request, and who took it. Not a reply form — do not use it as one |
| not started / in progress / done | `sections.state` | the request's states |
| progress | `sections.progress_at` | the last sign of movement. Used to tell a live request from an abandoned one |
| stale | derived from `progress_at` | in progress with no movement for long enough. A stale request returns to `not started` |
| break | not stored | the moment an agent writes an item. Writing is itself the claim that a unit of work finished, so it is when requests get picked up |
| minimum interval | `FUDA_PICKUP_MIN_INTERVAL` | the floor under picking up. Long stretches with no writes would otherwise leave requests sitting, so once enough time has passed an agent picks up without writing. Time, not turn count — turns do not correlate with how much work happened |

### Attribution

| Word | Where it exists | Meaning |
|---|---|---|
| attribution | `items.attribution` | where an item came from, as arbitrary labels. Not fixed columns: one agent supplies a session, a repository and a branch, another supplies whatever identifies it |

Attribution is the join key to anything outside fuda. Whatever identifies a machine, a directory or a session elsewhere can be put in here as a label, and fuda stays ignorant of what it means.

The **sender is not one of these labels**. It is required and single, which a set of optional labels cannot express, and it is one half of a pair whose other half is the recipient. Attribution keeps its own job: filtering, and joining outwards.

### The screen

| Word | Where it exists | Meaning |
|---|---|---|
| the list | left of the screen, `GET /api/items` | every open item, unanswered ones first and oldest first among those. It does not rank, and it does not suggest what to do next |
| the detail pane | right of the screen, `GET /api/items/:id` | the selected item, and where replying happens. There is no second screen: moving between screens is a round trip, and round trips are what fuda exists to remove |
| filter | query parameters on `GET /api/items` | narrowing the list. By attribution and state. Never by section kind — an item is a group of sections, so filtering by kind would cut items in half |
| search | `q` on `GET /api/items` | finding items by their text, including closed ones |

### Notifications

| Word | Where it exists | Meaning |
|---|---|---|
| notification | `sections.notified_at` | fired when something new becomes unanswered. Never for a reply-free section, never for a finished request |
| batch | `FUDA_NOTIFY_BATCH_WINDOW` | one message for everything that became unanswered inside a window |
| reminder | `sections.reminded_at` | one, at most, ever, for a long-unanswered section. Never for a deferred one |
| notification target | `FUDA_NOTIFY_TARGET` | where a notification is delivered. Pluggable. The only thing *target* means |

Only what is waiting on the person, or on nobody, is announced. Whatever is addressed to an agent is pulled at a break and never pushed.

### Leaving

| Word | Where it exists | Meaning |
|---|---|---|
| promotion | not stored | moving a conclusion out of fuda into wherever it is kept for good. Proposed, then approved. Nothing leaves automatically |
| retention | — | closed items are not deleted. They leave the list and stay searchable, indefinitely |
