/**
 * Conversion helpers between the wire-format confidence decimal (0..1) and the
 * human-facing percentage (0..100) shown in the settings UI.
 *
 * Invariants:
 * - Wire contract stays a 0..1 decimal. Percent display is UI-only.
 * - Round-trip: percentToDecimal(decimalToPercent(d)) === d for d in a 1-decimal
 *   percent grid (0, 0.01, ..., 1.0). Callers should not rely on exact identity
 *   for arbitrary floats — the helper deliberately rounds to 1 decimal place of
 *   percent precision.
 * - Both directions clamp out-of-range inputs.
 * - NaN inputs throw. Silent coercion of NaN would corrupt saved settings.
 */

const DECIMAL_MIN = 0;
const DECIMAL_MAX = 1;
const PERCENT_MIN = 0;
const PERCENT_MAX = 100;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number, received ${String(value)}`);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Convert a 0..1 decimal to a 0..100 percent, rounded to one decimal place.
 * Out-of-range inputs are clamped. NaN throws.
 */
export function decimalToPercent(decimal: number): number {
  assertFinite(decimal, "decimal");
  const clamped = clamp(decimal, DECIMAL_MIN, DECIMAL_MAX);
  // Round to 1 decimal place of percent (e.g., 65.0, 12.3).
  return Math.round(clamped * 1000) / 10;
}

/**
 * Convert a 0..100 percent to a 0..1 decimal.
 * Out-of-range inputs are clamped. NaN throws.
 */
export function percentToDecimal(percent: number): number {
  assertFinite(percent, "percent");
  const clamped = clamp(percent, PERCENT_MIN, PERCENT_MAX);
  // Round to 3 decimal places of the underlying decimal to absorb float drift
  // from the /100 division (e.g., 65 / 100 → 0.65 exactly).
  return Math.round(clamped * 10) / 1000;
}
