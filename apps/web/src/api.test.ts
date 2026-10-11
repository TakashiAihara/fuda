import { afterEach, describe, expect, it, vi } from 'vitest';
import { complaint, personIdentity, Refused, refetchAfter } from './api.ts';

describe('what a refused answer says', () => {
  it('repeats what the server said, because it knows what is wrong', () => {
    expect(complaint(new Refused(400, 'x is not one of the options offered'))).toBe(
      'x is not one of the options offered',
    );
    expect(complaint(new Refused(403, 'this is waiting on session:worker, not on person'))).toContain(
      'waiting on session:worker',
    );
  });

  it('says the section changed rather than who changed it', () => {
    // A 409 does not say whether somebody answered it or somebody postponed it,
    // so naming either would be a guess about another actor's intent.
    expect(complaint(new Refused(409, 'this is no longer waiting for an answer'))).toBe(
      'this section changed while it was open, so it is being reloaded — have another look',
    );
  });

  it('does not claim the section is already reloaded', () => {
    // The refetch has only been started when this text appears. Saying it has
    // finished would report an outcome nobody has seen, and the person is left
    // looking at the stale screen if it does not come back.
    expect(complaint(new Refused(409, 'this is no longer waiting for an answer'))).toContain(
      'is being reloaded',
    );
    expect(complaint(new Refused(409, 'this is no longer waiting for an answer'))).not.toContain(
      'has been reloaded',
    );
  });

  it('says the answer may have got there when the connection broke', () => {
    // The request may have been recorded before the reply was lost, so saying
    // it did not reach fuda would have the person answer a settled section
    // again — and against the server's own version of the same section.
    const said = complaint(new TypeError('fetch failed'));

    expect(said).toBe('the answer may or may not have reached fuda — reloading to show what fuda recorded');
    expect(said).not.toContain('did not reach');
  });

  it('says the same about an error that is not an exception at all', () => {
    // Whatever the mutation is handed has to reach the person as the unknown
    // outcome it is, not as a verdict about a request that may have landed.
    expect(complaint('something else entirely')).toBe(
      'the answer may or may not have reached fuda — reloading to show what fuda recorded',
    );
  });
});

describe('when a failed answer makes the screen ask again', () => {
  it('asks again after a connection that broke', () => {
    // Nothing said the answer was refused, so the row on screen may describe a
    // section the server has already settled. Only a refetch can tell.
    expect(refetchAfter(new TypeError('fetch failed'))).toBe(true);
    expect(refetchAfter('something else entirely')).toBe(true);
  });

  it('asks again when the section moved under the screen', () => {
    expect(refetchAfter(new Refused(409, 'this is no longer waiting for an answer'))).toBe(true);
  });

  it('does not ask again when the server refused the answer itself', () => {
    // The server read the answer and said no. Nothing moved, so a refetch
    // brings back the same section and only costs a round trip.
    expect(refetchAfter(new Refused(400, 'x is not one of the options offered'))).toBe(false);
    expect(refetchAfter(new Refused(403, 'this is waiting on session:worker, not on person'))).toBe(false);
    expect(refetchAfter(new Refused(404, 'no such section'))).toBe(false);
  });
});

/** A `fetch` that answers with one status and one body, whatever was asked. */
const answeringWith = (status: number, body: unknown) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('who the person is', () => {
  it('takes the name the server gives', async () => {
    answeringWith(200, { identity: 'person' });

    expect(await personIdentity()).toBe('person');
  });

  it('keeps what the server said when it failed', async () => {
    // The same turn the rest of the client makes: a server that knows what is
    // wrong says so, and a screen that answered this one differently would
    // report a server fault as a missing name.
    answeringWith(500, { error: 'the database is not reachable' });

    await expect(personIdentity()).rejects.toThrow(new Refused(500, 'the database is not reachable'));
  });

  it('fails on an error body that says nothing at all', async () => {
    answeringWith(500, {});

    await expect(personIdentity()).rejects.toThrow(new Refused(500, 'fuda answered 500'));
  });

  it('refuses a success that carries no name', async () => {
    // A 200 is not a name. Showing the list under no identity at all would
    // quietly filter it to nothing, which looks like an empty inbox.
    answeringWith(200, {});

    await expect(personIdentity()).rejects.toThrow('fuda did not say who the person is');
  });

  it('refuses a name the server left blank', async () => {
    answeringWith(200, { identity: '' });

    await expect(personIdentity()).rejects.toThrow('fuda did not say who the person is');
  });
});
