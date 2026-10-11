import type { ChoiceReply } from '@fuda/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Section as Row } from './api.ts';
import { complaint, sendReply } from './api.ts';
import { answerableBy, choiceAnswer, choiceShown, sendsOnKey } from './choice.ts';

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

      {/* Plain text for now: markdown means rendering it as HTML, which is a
          decision worth making once rather than by accident. */}
      <div className="body">{section.body.text}</div>

      {section.replyForm === 'choice' ? (
        <Choice section={section} person={person} />
      ) : (
        <ReadOnly section={section} />
      )}
    </div>
  );
}

function Choice({ section, person }: { section: Row; person: string | null }) {
  const options = section.body.options ?? [];
  const client = useQueryClient();
  const [note, setNote] = useState('');
  const [said, setSaid] = useState<string | null>(null);

  // What was said about a failed answer stops being true once the section has
  // moved on, and the moved section speaks for itself.
  useEffect(() => setSaid(null), [section.state]);

  const answer = useMutation({
    mutationFn: (reply: ChoiceReply) => sendReply(section.id, reply),
    onSuccess: () => {
      setNote('');
      setSaid(null);
      void client.invalidateQueries();
    },
    onError: (error: unknown) => {
      setSaid(complaint(error));

      // Not a retry. Whatever failed, the row on screen may no longer be what
      // fuda holds, and only a refetch can say.
      void client.invalidateQueries();
    },
  });

  // The stored reply is whatever the form that answered it carries, and nothing
  // in the row says which — except the reply form this branch is already in.
  const replied = section.reply as ChoiceReply | null;

  if (section.state === 'answered') {
    const shown = choiceShown(options, replied);

    return (
      <div className="reply">
        <p className="reply-hint">answered by {section.answeredBy ?? 'someone'}</p>
        {shown === null ? null : <p className="answered-note">{shown}</p>}
        {said === null ? null : <p className="complaint">{said}</p>}
      </div>
    );
  }

  if (section.state !== 'unanswered') {
    return (
      <div className="reply">
        <p className="reply-hint">{hint(section)}</p>
        {said === null ? null : <p className="complaint">{said}</p>}
      </div>
    );
  }

  if (!answerableBy(section.recipient, person)) {
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

  const send = (option: string | null) => {
    const reply = choiceAnswer(option, note);

    if (reply !== null) answer.mutate(reply);
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
            disabled={answer.isPending}
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
          disabled={answer.isPending}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            const { isComposing, keyCode } = event.nativeEvent;

            if (!sendsOnKey(event.key, isComposing, keyCode) || answer.isPending) return;

            send(null);
          }}
        />
        <div className="reply-actions">
          <button
            className="btn primary"
            disabled={answer.isPending || note.trim() === ''}
            onClick={() => send(null)}
          >
            send
          </button>
        </div>
      </div>

      {said === null ? null : <p className="complaint">{said}</p>}
    </div>
  );
}

/** Every other reply form, read-only in this slice. The state says all there is. */
function ReadOnly({ section }: { section: Row }) {
  if (section.replyForm === null) return null;

  const said = answeredText(section);

  return (
    <div className="reply">
      <p className="reply-hint">{hint(section)}</p>
      {section.body.link === undefined ? null : (
        <div className="reply-actions">
          <a className="link-out" href={section.body.link} target="_blank" rel="noreferrer">
            open elsewhere ↗
          </a>
        </div>
      )}
      {said === null ? null : <p className="answered-note">{said}</p>}
    </div>
  );
}

/**
 * What an answer reads as, per reply form. Nothing here can be given from this
 * screen yet, so the answer is shown rather than offered again.
 */
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

  return `A ${labelOf(section)}. This screen answers choices; the rest arrive with their own commands.`;
}

const labelOf = (section: Row) => (section.replyForm ?? '').replace('_', ' ');
