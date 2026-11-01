import type { ApprovalReply, ChoiceReply, Reply } from '@fuda/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { Section as Row } from './api.ts';
import { complaint, sendReply, setPostponed } from './api.ts';
import { answerableBy, choiceAnswer, choiceShown, sendsOnKey } from './choice.ts';
import { approvalAnswer, controlsFor, freeTextAnswer } from './forms.ts';

/**
 * One section: what it says, and whatever can be done with it from here.
 *
 * Replying happens inside the detail pane. There is nowhere else to go, and a
 * round trip to somewhere else is the thing this project exists to remove.
 */
export function Section({ section, person }: { section: Row; person: string | null }) {
  return (
    <div className="section">
      <div className="section-head">
        <span className="kind">{section.kind.replace('_', ' ')}</span>
        {section.state === null ? null : (
          <span className={`state ${section.state}`}>{section.state.replace('_', ' ')}</span>
        )}
        <span className="to">→ {section.recipient ?? 'anyone'}</span>
      </div>

      {/* Bodies come from agents. No rehype-raw, so HTML stays text, and no
          image elements (only the alt is shown), which the browser would fetch the moment the item is opened —
          from any address the agent wrote, LAN included. A single newline is a
          line break, because agents write plain lines as often as markdown. */}
      <div className="body">
        <Markdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={{
            a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
            img: ({ alt }) =>
              alt === undefined || alt === '' ? null : <span className="image-alt">[{alt}]</span>,
          }}
        >
          {section.body.text}
        </Markdown>
      </div>

      {/* Under the body rather than inside the answer controls: the place the
          work was done stays reachable after it is settled, postponed, or while
          it waits on someone else. The scheme is limited to http(s) when written. */}
      {section.body.link === undefined ? null : (
        <div className="reply-actions">
          <a className="link-out" href={section.body.link} target="_blank" rel="noreferrer">
            open elsewhere ↗
          </a>
        </div>
      )}

      {section.replyForm === 'choice' ? (
        <Choice section={section} person={person} />
      ) : section.replyForm === 'free_text' ||
        section.replyForm === 'approval' ||
        section.replyForm === 'external_tool' ? (
        <Form section={section} person={person} />
      ) : (
        <ReadOnly section={section} />
      )}
    </div>
  );
}

/**
 * One call against a section, and what is said when it fails.
 *
 * A failure refetches rather than retries. Whatever failed, the row on screen
 * may no longer be what fuda holds, and only a refetch can say.
 */
function useAction<T>(section: Row, run: (argument: T) => Promise<unknown>, onDone?: () => void) {
  const client = useQueryClient();
  const [said, setSaid] = useState<string | null>(null);

  // What was said about a failed call stops being true once the section has
  // moved on, and the moved section speaks for itself.
  useEffect(() => setSaid(null), [section.state]);

  const action = useMutation({
    mutationFn: run,
    onSuccess: () => {
      onDone?.();
      setSaid(null);
      void client.invalidateQueries();
    },
    onError: (error: unknown) => {
      setSaid(complaint(error));
      void client.invalidateQueries();
    },
  });

  return { send: action.mutate, pending: action.isPending, said };
}

function Complaint({ said }: { said: string | null }) {
  return said === null ? null : <p className="complaint">{said}</p>;
}

function Waiting({ section, person }: { section: Row; person: string | null }) {
  return (
    <div className="reply">
      <p className="reply-hint">
        {person === null
          ? 'Finding out who you are before offering anything to answer.'
          : `Waiting on ${section.recipient ?? 'anyone'}. Nothing is owed by you.`}
      </p>
    </div>
  );
}

/** Postponing is available beside any answer; taking it back up replaces them. */
function Later({ section }: { section: Row }) {
  const postpone = useAction(section, (postponed: boolean) => setPostponed(section.id, postponed));
  const resuming = section.state === 'deferred';

  return (
    <>
      <button className="btn ghost" disabled={postpone.pending} onClick={() => postpone.send(!resuming)}>
        {resuming ? 'resume' : 'later'}
      </button>
      <Complaint said={postpone.said} />
    </>
  );
}

function Choice({ section, person }: { section: Row; person: string | null }) {
  const options = section.body.options ?? [];
  const [note, setNote] = useState('');
  const answer = useAction(
    section,
    (reply: ChoiceReply) => sendReply(section.id, reply),
    () => setNote(''),
  );

  // The stored reply is whatever the form that answered it carries, and nothing
  // in the row says which — except the reply form this branch is already in.
  const replied = section.reply as ChoiceReply | null;

  if (section.state === 'answered') {
    const shown = choiceShown(options, replied);

    return (
      <div className="reply">
        <p className="reply-hint">answered by {section.answeredBy ?? 'someone'}</p>
        {shown === null ? null : <p className="answered-note">{shown}</p>}
        <Complaint said={answer.said} />
      </div>
    );
  }

  const controls = controlsFor(section.replyForm, section.state, answerableBy(section.recipient, person));

  if (section.state === 'deferred') {
    return (
      <div className="reply">
        <p className="reply-hint">{hint(section)}</p>
        {controls.resume ? (
          <div className="reply-actions">
            <Later section={section} />
          </div>
        ) : null}
        <Complaint said={answer.said} />
      </div>
    );
  }

  if (section.state !== 'unanswered') {
    return (
      <div className="reply">
        <p className="reply-hint">{hint(section)}</p>
        <Complaint said={answer.said} />
      </div>
    );
  }

  if (!controls.answer) return <Waiting section={section} person={person} />;

  const send = (option: string | null) => {
    const reply = choiceAnswer(option, note);

    if (reply !== null) answer.send(reply);
  };

  return (
    <div className="reply">
      <p className="reply-hint">
        Pick one, or write your own answer below. Anything written below is also sent with the option you
        click.
      </p>

      <div className="choices">
        {options.map((option) => (
          <button
            key={option.value}
            className={option.recommended === true ? 'btn recommended-option' : 'btn'}
            disabled={answer.pending}
            onClick={() => send(option.value)}
          >
            {option.label}
            {/* A mark, not a different button: the recommended option is one of
                the options, and it is answered the same way. */}
            {option.recommended === true ? <span className="recommended">★ recommended</span> : null}
          </button>
        ))}
      </div>

      {/* Always there. The screen offers "other" because the person has an
          answer the agent did not think of, and an agent must not be asked to
          write an option for it. */}
      <div className="other">
        <input
          className="field"
          aria-label="something else"
          value={note}
          placeholder="something else, in your own words"
          disabled={answer.pending}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            const { isComposing, keyCode } = event.nativeEvent;

            if (!sendsOnKey(event.key, isComposing, keyCode) || answer.pending) return;

            send(null);
          }}
        />
        <div className="reply-actions">
          <button
            className="btn primary"
            disabled={answer.pending || note.trim() === ''}
            onClick={() => send(null)}
          >
            send
          </button>
          <Later section={section} />
        </div>
      </div>

      <Complaint said={answer.said} />
    </div>
  );
}

/** Free text, approval and external tool: each settled by one control, plus postponing. */
function Form({ section, person }: { section: Row; person: string | null }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const answer = useAction(
    section,
    (reply: Reply) => sendReply(section.id, reply),
    () => {
      setText('');
      setNote('');
    },
  );

  const controls = controlsFor(section.replyForm, section.state, answerableBy(section.recipient, person));

  if (section.state === 'answered') {
    const said = answeredText(section);

    return (
      <div className="reply">
        <p className="reply-hint">answered by {section.answeredBy ?? 'someone'}</p>
        {said === null ? null : <p className="answered-note">{said}</p>}
        <Complaint said={answer.said} />
      </div>
    );
  }

  if (section.state === 'deferred') {
    return (
      <div className="reply">
        <p className="reply-hint">{hint(section)}</p>
        {controls.resume ? (
          <div className="reply-actions">
            <Later section={section} />
          </div>
        ) : null}
        <Complaint said={answer.said} />
      </div>
    );
  }

  if (section.state !== 'unanswered') {
    return (
      <div className="reply">
        <p className="reply-hint">{hint(section)}</p>
        <Complaint said={answer.said} />
      </div>
    );
  }

  if (!controls.answer) return <Waiting section={section} person={person} />;

  const sendText = () => {
    const reply = freeTextAnswer(text);

    if (reply !== null) answer.send(reply);
  };
  const decide = (decision: ApprovalReply['decision']) => answer.send(approvalAnswer(decision, note));

  return (
    <div className="reply">
      {section.replyForm === 'free_text' ? (
        <>
          <input
            className="field"
            aria-label="your answer"
            value={text}
            disabled={answer.pending}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              const { isComposing, keyCode } = event.nativeEvent;

              if (!sendsOnKey(event.key, isComposing, keyCode) || answer.pending) return;

              sendText();
            }}
          />
          <div className="reply-actions">
            <button
              className="btn primary"
              disabled={answer.pending || text.trim() === ''}
              onClick={sendText}
            >
              send
            </button>
            <Later section={section} />
          </div>
        </>
      ) : null}

      {section.replyForm === 'approval' ? (
        <>
          <input
            className="field"
            aria-label="note (optional)"
            value={note}
            placeholder="note (optional)"
            disabled={answer.pending}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="reply-actions">
            <button className="btn primary" disabled={answer.pending} onClick={() => decide('proceed')}>
              proceed
            </button>
            <button className="btn" disabled={answer.pending} onClick={() => decide('decline')}>
              decline
            </button>
            <Later section={section} />
          </div>
        </>
      ) : null}

      {section.replyForm === 'external_tool' ? (
        <div className="reply-actions">
          <button className="btn primary" disabled={answer.pending} onClick={() => answer.send({})}>
            done
          </button>
          <Later section={section} />
        </div>
      ) : null}

      <Complaint said={answer.said} />
    </div>
  );
}

/** Pickup, which is taken and finished rather than answered. The state says all there is. */
function ReadOnly({ section }: { section: Row }) {
  if (section.replyForm === null) return null;

  const said = answeredText(section);

  return (
    <div className="reply">
      <p className="reply-hint">{hint(section)}</p>
      {said === null ? null : <p className="answered-note">{said}</p>}
    </div>
  );
}

/** What an answer reads as, per reply form. */
function answeredText(section: Row): string | null {
  const reply = section.reply;

  if (reply === null) return null;

  if ('text' in reply && reply.text !== undefined) return reply.text;

  // The note is shown with the decision rather than instead of it, or an
  // approval answered with both reads as a bare decision.
  if ('decision' in reply && reply.decision !== undefined) {
    return reply.note === undefined ? reply.decision : `${reply.decision} — ${reply.note}`;
  }

  if ('note' in reply && reply.note !== undefined) return reply.note;

  return null;
}

function hint(section: Row): string {
  if (section.state === 'deferred') {
    return 'Postponed. Nobody is waiting on it, and it is never reminded about.';
  }

  if (section.state === 'in_progress') return 'Taken. It comes back as a report.';
  if (section.state === 'not_started') return 'Waiting to be taken. Nothing is owed by you.';
  if (section.state === 'done') return 'Done.';
  if (section.state === 'answered') return `Answered by ${section.answeredBy ?? 'someone'}.`;

  return `A ${labelOf(section)}. It is taken and finished elsewhere, not answered here.`;
}

const labelOf = (section: Row) => (section.replyForm ?? '').replace('_', ' ');
