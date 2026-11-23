import { describe, expect, it } from 'vitest';
import { commit, initHistory, redo, undo } from './history.ts';

describe('history', () => {
  it('undoes and redoes in order', () => {
    let h = initHistory(0);
    for (let i = 1; i <= 5; i++) h = commit(h, i);
    h = undo(undo(h));
    expect(h.present).toBe(3);
    h = redo(h);
    expect(h.present).toBe(4);
    h = commit(h, 10);
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });
  it('is a no-op at the ends', () => {
    const h = initHistory('a');
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
  it('keeps at least 50 steps and caps at the limit', () => {
    let h = initHistory(0);
    for (let i = 1; i <= 60; i++) h = commit(h, i, 50);
    expect(h.past).toHaveLength(50);
    for (let i = 0; i < 50; i++) h = undo(h);
    expect(h.present).toBe(10);
  });
});
