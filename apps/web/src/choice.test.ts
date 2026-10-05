import type { SectionOption } from '@fuda/core';
import { describe, expect, it } from 'vitest';
import { answerableBy, choiceAnswer, choiceShown } from './choice.ts';

const options: SectionOption[] = [
  { value: 'throw', label: 'raise an exception' },
  { value: 'null', label: 'return null', recommended: true },
];

describe('what a click or a word sends', () => {
  it('sends the option that was clicked', () => {
    expect(choiceAnswer('throw', '')).toEqual({ option: 'throw' });
  });

  it('sends the note on its own, which is how something else is answered', () => {
    expect(choiceAnswer(null, 'neither, do both')).toEqual({ note: 'neither, do both' });
  });

  it('trims the note rather than sending the spaces', () => {
    expect(choiceAnswer(null, '  neither  ')).toEqual({ note: 'neither' });
  });

  it('sends both when there is something to say about the option', () => {
    expect(choiceAnswer('null', 'but rename it')).toEqual({ option: 'null', note: 'but rename it' });
  });

  it('sends nothing when nothing was clicked and nothing was written', () => {
    expect(choiceAnswer(null, '')).toBeNull();
    expect(choiceAnswer(null, '   ')).toBeNull();
  });
});

describe('what an answered choice reads as', () => {
  it('reads back the label, not the value', () => {
    // The label is what was on the button. The value is the agent's own name
    // for it and means nothing to the person who answered.
    expect(choiceShown(options, { option: 'null' })).toBe('return null');
  });

  it('reads a note on its own', () => {
    expect(choiceShown(options, { note: 'neither' })).toBe('neither');
  });

  it('reads an option and its note together', () => {
    expect(choiceShown(options, { option: 'throw', note: 'not in the reader' })).toBe(
      'raise an exception — not in the reader',
    );
  });

  it('shows a value it does not recognise rather than dropping it', () => {
    expect(choiceShown(options, { option: 'invented' })).toBe('invented');
  });

  it('has nothing to say about a choice nobody answered', () => {
    expect(choiceShown(options, null)).toBeNull();
    expect(choiceShown(options, {})).toBeNull();
  });
});

describe('who may answer it', () => {
  it('lets the person answer what is addressed to them', () => {
    expect(answerableBy('person', 'person')).toBe(true);
  });

  it('lets anybody answer what is addressed to nobody', () => {
    // The same rule the server applies: an unaddressed request is whichever
    // one reaches it first.
    expect(answerableBy(null, 'person')).toBe(true);
    expect(answerableBy(null, null)).toBe(true);
  });

  it('does not let the person answer what is addressed to somebody else', () => {
    expect(answerableBy('session:worker', 'person')).toBe(false);
  });

  it('claims nothing while who the person is has not arrived', () => {
    // The name is configuration. Guessing it would show the wrong controls and
    // then have the server refuse them.
    expect(answerableBy('person', null)).toBe(false);
  });
});
