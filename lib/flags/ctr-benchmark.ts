/**
 * Expected organic CTR by average SERP position — the benchmark for the
 * "CTR-position mismatch" flag (brief §6). These are conservative industry
 * averages; they can be replaced with site-specific values from the Ahrefs
 * `gsc-ctr-by-position` endpoint later without changing callers.
 */
const BENCHMARK: Record<number, number> = {
  1: 0.28,
  2: 0.155,
  3: 0.1,
  4: 0.07,
  5: 0.05,
  6: 0.04,
  7: 0.03,
  8: 0.021,
  9: 0.018,
  10: 0.015,
};

/** Expected CTR for a (decimal) average position. Positions >10 → ~0.01. */
export function expectedCtr(position: number): number {
  if (position <= 0) return 0;
  if (position >= 11) return 0.01;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  if (lo === hi) return BENCHMARK[lo] ?? 0.01;
  const a = BENCHMARK[lo] ?? 0.01;
  const b = BENCHMARK[hi] ?? 0.01;
  // Linear interpolation between whole-position benchmarks.
  return a + (b - a) * (position - lo);
}
