import { describe, expect, it } from 'vitest';
import { nextPieceNames } from './naming.ts';

describe('nextPieceNames', () => {
  it('starts at 1 for an empty library', () => {
    expect(nextPieceNames([], 2)).toEqual(['Piece 1', 'Piece 2']);
  });
  it('continues after a previous scan', () => {
    expect(nextPieceNames(['Piece 1', 'Piece 2'], 2)).toEqual(['Piece 3', 'Piece 4']);
  });
  it('counts renamed pieces too, so numbers reflect the total', () => {
    expect(nextPieceNames(['Beach print', 'Map'], 1)).toEqual(['Piece 3']);
  });
  it('never reuses a number after deletes', () => {
    expect(nextPieceNames(['Piece 7'], 1)).toEqual(['Piece 8']);
  });
  it('skips names that are taken', () => {
    expect(nextPieceNames(['Piece 1', 'x', 'Piece 4'], 2)).toEqual(['Piece 5', 'Piece 6']);
  });
});
