// Default names for new pieces: "Piece N", numbered across the whole library
// so separate scans never produce duplicates.

const PIECE_N = /^Piece (\d+)$/;

/**
 * `count` new names continuing after max(library size, highest "Piece N"),
 * skipping any name already taken.
 */
export function nextPieceNames(existingNames: readonly string[], count: number): string[] {
  const taken = new Set(existingNames);
  let n = existingNames.length;
  for (const name of existingNames) {
    const m = PIECE_N.exec(name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  const out: string[] = [];
  while (out.length < count) {
    n++;
    const name = `Piece ${n}`;
    if (!taken.has(name)) out.push(name);
  }
  return out;
}
