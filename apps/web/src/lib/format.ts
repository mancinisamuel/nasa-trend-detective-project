// Display formatting only: values come from the API and are rounded for reading, never recomputed.

const signedNumber = new Intl.NumberFormat("en", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

const pValueNumber = new Intl.NumberFormat("en", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** Signed value with two decimals, e.g. "+0.45" or "-0.12". */
export function formatSigned(value: number): string {
  return signedNumber.format(value);
}

/** p-value with three decimals; below 0.001 shown as "< 0.001". */
export function formatPValue(p: number): string {
  return p < 0.001 ? "< 0.001" : pValueNumber.format(p);
}

/** Interval as "[low, high]". */
export function formatInterval(low: number, high: number): string {
  return `[${formatSigned(low)}, ${formatSigned(high)}]`;
}

/** Year range as "1981–2025". */
export function formatYearRange(start: number, end: number): string {
  return `${String(start)}–${String(end)}`;
}
