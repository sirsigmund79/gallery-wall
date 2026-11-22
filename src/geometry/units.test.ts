import { describe, expect, it } from 'vitest';
import {
  defaultUnitForLocale,
  formatInches,
  formatLength,
  inToMm,
  mmToIn,
  parseLength,
} from './units.ts';

describe('conversion', () => {
  it('round-trips', () => {
    expect(mmToIn(25.4)).toBeCloseTo(1);
    expect(inToMm(mmToIn(123.45))).toBeCloseTo(123.45);
  });
});

describe('formatInches', () => {
  it.each([
    [11.4375, '11 7/16'],
    [12, '12'],
    [0.5, '1/2'],
    [0.25, '1/4'],
    [8.125, '8 1/8'],
    [0, '0'],
    [0.01, '0'],
    [15.97, '16'], // rounds up into the next whole inch
    [-2.5, '-2 1/2'],
  ])('%f -> %s', (v, s) => expect(formatInches(v)).toBe(s));

  it('never contains a decimal point', () => {
    for (let i = 0; i < 2000; i++) {
      expect(formatInches(i * 0.0371)).not.toMatch(/\./);
    }
  });
});

describe('formatLength', () => {
  it('formats in each unit', () => {
    expect(formatLength(inToMm(11 + 7 / 16), 'in')).toBe('11 7/16 in');
    expect(formatLength(297, 'cm')).toBe('29.7 cm');
    expect(formatLength(300, 'cm')).toBe('30 cm');
    expect(formatLength(297.4, 'mm')).toBe('297 mm');
  });
});

describe('parseLength', () => {
  it.each([
    ['11 7/16', 'in', inToMm(11.4375)],
    ['11-7/16', 'in', inToMm(11.4375)],
    ['7/16', 'in', inToMm(0.4375)],
    ['11.5', 'in', inToMm(11.5)],
    ['11"', 'cm', inToMm(11)],
    ['11 in', 'mm', inToMm(11)],
    ['29.7 cm', 'in', 297],
    ['29,7', 'cm', 297],
    ['297mm', 'in', 297],
    ['  85.6 MM ', 'in', 85.6],
  ] as const)('%s (%s) -> %f mm', (s, u, mm) => {
    expect(parseLength(s, u)).toBeCloseTo(mm, 6);
  });

  it.each(['', 'abc', '1/0', '1 2/0', '-3', '1.2.3', '5 ft'])('rejects %j', (s) => {
    expect(parseLength(s, 'in')).toBeNull();
  });

  it('round-trips through formatLength for 1/16 in values', () => {
    for (let n = 1; n < 800; n++) {
      const mm = inToMm(n / 16);
      expect(parseLength(formatLength(mm, 'in'), 'mm')).toBeCloseTo(mm, 6);
    }
  });
});

describe('defaultUnitForLocale', () => {
  it.each([
    ['en-US', 'in'],
    ['en', 'in'], // maximizes to en-Latn-US
    ['en-GB', 'cm'],
    ['fr-CA', 'cm'],
    ['de-DE', 'cm'],
    [undefined, 'cm'],
    ['garbage!!', 'cm'],
  ] as const)('%s -> %s', (l, u) => expect(defaultUnitForLocale(l)).toBe(u));
});
