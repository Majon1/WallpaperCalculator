import { formatLength } from '../model/units';

/** "250 cm" for a level wall, "250–190 cm" for a sloped one (start → end). */
export function formatWallHeights(h: { start: number; end: number }): string {
  if (Math.abs(h.start - h.end) < 0.5) return formatLength(h.start);
  return `${formatLength(h.start).replace(' cm', '')}–${formatLength(h.end)}`;
}

/** 74.7 → "74.70 €" */
export const formatMoney = (amount: number, currency: string): string => `${amount.toFixed(2)} ${currency}`;

const ROLL_COLORS = ['#3b7dd8', '#d9822b', '#2e9e6a', '#c2457a', '#7a5cc4', '#b8a11e', '#1f9bb0', '#c4473b', '#5d7a2e', '#8a6248'];

/** Colour for roll number `index` (0-based), used in the wall view and the cutting plan. */
export const rollColor = (index: number): string => ROLL_COLORS[index % ROLL_COLORS.length];
