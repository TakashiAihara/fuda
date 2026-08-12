import { describe, expect, it } from 'vitest';
import { createReporter } from './report.ts';

describe('the reporter', () => {
  it('sends the answer and everything else to different places', () => {
    const answers: string[] = [];
    const notes: string[] = [];
    const report = createReporter(
      (t) => answers.push(t),
      (t) => notes.push(t),
    );

    report.say('the item');
    report.note('could not reach fuda');

    expect(answers).toEqual(['the item']);
    expect(notes).toEqual(['could not reach fuda']);
  });

  it('can be built so that nothing at all reaches the answer stream', () => {
    // What `fuda mcp` will do: its stdout carries protocol frames, where a
    // stray line is not noise but a corrupt message.
    const answers: string[] = [];
    const notes: string[] = [];
    const report = createReporter(
      (t) => notes.push(t),
      (t) => notes.push(t),
    );

    report.say('this would have been an answer');
    report.note('and this a warning');

    expect(answers).toEqual([]);
    expect(notes).toHaveLength(2);
  });
});
