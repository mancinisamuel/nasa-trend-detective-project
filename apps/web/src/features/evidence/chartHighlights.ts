/**
 * Highlight colours of the chart (UI-DESIGN-10). Same values as the --highlight-* tokens in
 * tokens.css; SVG attributes (and the PNG export) need plain colours, not CSS variables.
 * Orange/blue stay apart for the common colour-vision deficiencies; shape and label carry the
 * meaning as well.
 */
export const HIGHLIGHT = {
  max: "#f08a3c",
  min: "#4aa8e0",
  trend: "#e8b86d",
} as const;

export type ExtremePoint = { year: number; value: number };

/**
 * Highest and lowest value of a delivered series, for marking them in the chart. Display only:
 * no value is computed, the points are picked as they come from the API. Null when the series
 * has fewer than two values or all values are equal; ties keep the earliest year.
 */
export function extremePoints(
  observations: readonly { year: number; value: number | null }[],
): { max: ExtremePoint; min: ExtremePoint } | null {
  let max: ExtremePoint | null = null;
  let min: ExtremePoint | null = null;
  let count = 0;
  for (const { year, value } of observations) {
    if (value === null || !Number.isFinite(value)) continue;
    count += 1;
    if (max === null || value > max.value) max = { year, value };
    if (min === null || value < min.value) min = { year, value };
  }
  if (count < 2 || max === null || min === null || max.value === min.value) {
    return null;
  }
  return { max, min };
}

/** Direction of the API slope for the arrow of the headline figure (display only). */
export function trendDirection(slope: number): "up" | "down" | "flat" {
  if (slope > 0) return "up";
  if (slope < 0) return "down";
  return "flat";
}
