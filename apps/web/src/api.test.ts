import { afterEach, describe, expect, it, vi } from 'vitest';
import { complaint, personIdentity, Refused } from './api.ts';

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

  it('says the answer may not have got there when the connection broke', () => {
    // The request may have been recorded before the reply was lost, so saying
    // it did not reach fuda would be a verdict nobody can give.
    expect(complaint(new TypeError('fetch failed'))).toBe(
      'the answer may not have reached fuda — reloading what fuda recorded',
    );
  });

  it('says the same about a server error, which can follow a write that happened', () => {
    expect(complaint(new Refused(503, 'fuda answered 503'))).toBe(
      'the answer may not have reached fuda — reloading what fuda recorded',
    );
    expect(complaint(new Refused(500, 'fuda answered 500'))).toBe(
      'the answer may not have reached fuda — reloading what fuda recorded',
    );
  });

  it('keeps the server words for the last status below a server error', () => {
    expect(complaint(new Refused(499, 'closed before an answer'))).toBe('closed before an answer');
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

  it('refuses a name that is not a string', async () => {
    answeringWith(200, { identity: null });

    await expect(personIdentity()).rejects.toThrow('fuda did not say who the person is');

    answeringWith(200, { identity: 42 });

    await expect(personIdentity()).rejects.toThrow('fuda did not say who the person is');
  });

  it('refuses a name the server left blank', async () => {
    answeringWith(200, { identity: '' });

    await expect(personIdentity()).rejects.toThrow('fuda did not say who the person is');
  });
});
