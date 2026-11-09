const UNIT_TO_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000 };

/**
 * Parse a user-entered length into millimetres.
 * Accepts "345", "345,5", "345 cm", "3450mm", "3.45 m". No unit = centimetres.
 * Returns null for anything that isn't a non-negative length.
 */
export function parseLength(input: string): number | null {
  const match = input
    .trim()
    .toLowerCase()
    .replace(',', '.')
    .match(/^(\d+(?:\.\d*)?|\.\d+)\s*(mm|cm|m)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const factor = UNIT_TO_MM[match[2] ?? 'cm'];
  return Math.round(value * factor * 10) / 10;
}

/** Centimetres, to the nearest millimetre, without trailing zeros: 3450 → "345", 1234.5 → "123.5". */
export const formatLengthValue = (mm: number): string => String(Math.round(mm) / 10);

/** 3450 → "345 cm", 1234.5 → "123.5 cm" */
export const formatLength = (mm: number): string => `${formatLengthValue(mm)} cm`;

/** 12_000_000 → "12.00 m²" */
export const formatArea = (mm2: number): string => `${(mm2 / 1_000_000).toFixed(2)} m²`;
