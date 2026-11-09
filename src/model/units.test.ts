import { describe, expect, it } from 'vitest';
import { formatArea, formatLength, formatLengthValue, parseLength } from './units';

describe('parseLength', () => {
  it.each([
    ['345', 3450],
    ['345,5', 3455],
    ['12.34', 123.4],
    [' 3.45 m ', 3450],
    ['3,45m', 3450],
    ['345 cm', 3450],
    ['345cm', 3450],
    ['3450 mm', 3450],
    ['.5', 5],
    ['2', 20],
    ['0', 0],
  ])('parses %j as %d mm', (input, expected) => {
    expect(parseLength(input)).toBe(expected);
  });

  it.each(['', 'abc', '-1', '3.4.5', '3 ft', 'm'])('rejects %j', (input) => {
    expect(parseLength(input)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats lengths and areas', () => {
    expect(formatLength(3450)).toBe('345 cm');
    expect(formatLength(900)).toBe('90 cm');
    expect(formatLength(1234.5)).toBe('123.5 cm');
    expect(formatArea(12_000_000)).toBe('12.00 m²');
    expect(formatLengthValue(3450)).toBe('345');
    expect(formatLengthValue(2500)).toBe('250');
    expect(formatLengthValue(1234.4)).toBe('123.4');
    expect(formatLengthValue(1234.5)).toBe('123.5');
  });
});
