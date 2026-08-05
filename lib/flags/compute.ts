import { expectedCtr } from "./ctr-benchmark";

/**
 * Pure flag computations for the article-list view (brief §6). Kept
 * side-effect-free and unit-testable; the cannibalization flag is sourced
 * separately (see cannibalization.ts) because it comes from an external skill.
 */

export const DECLINE_PERIODS = 3; // "N consecutive periods" of falling clicks
// How far below the position-benchmark CTR counts as a mismatch (e.g. 0.6 = 40% under).
export const CTR_MISMATCH_RATIO = 0.6;
// Only flag CTR mismatch when the page is actually ranking well.
export const CTR_MISMATCH_MAX_POSITION = 10;

/**
 * Declining: clicks fall for N consecutive periods. `series` is clicks ordered
 * oldest → newest. Requires at least N+1 points; each of the last N steps must
 * be a strict decrease.
 */
export function isDeclining(series: number[], n: number = DECLINE_PERIODS): boolean {
  if (series.length < n + 1) return false;
  const tail = series.slice(-(n + 1));
  for (let i = 1; i < tail.length; i++) {
    if (tail[i] >= tail[i - 1]) return false;
  }
  return true;
}

/**
 * CTR-position mismatch: the page ranks well (position ≤ max) but its CTR is
 * meaningfully below the expected benchmark for that position.
 */
export function isCtrMismatch(
  position: number,
  ctr: number,
  opts: { ratio?: number; maxPosition?: number } = {},
): boolean {
  const ratio = opts.ratio ?? CTR_MISMATCH_RATIO;
  const maxPos = opts.maxPosition ?? CTR_MISMATCH_MAX_POSITION;
  if (position <= 0 || position > maxPos) return false;
  const benchmark = expectedCtr(position);
  if (benchmark <= 0) return false;
  return ctr < benchmark * ratio;
}
