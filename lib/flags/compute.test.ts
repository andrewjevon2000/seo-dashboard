import { describe, it, expect } from "vitest";
import { isDeclining, isCtrMismatch } from "./compute";

describe("isDeclining", () => {
  it("flags 3 consecutive strict decreases", () => {
    expect(isDeclining([100, 90, 80, 70])).toBe(true);
  });
  it("does not flag when a period rises", () => {
    expect(isDeclining([100, 90, 95, 80])).toBe(false);
  });
  it("does not flag flat periods", () => {
    expect(isDeclining([80, 80, 80, 80])).toBe(false);
  });
  it("flags with a custom shorter window", () => {
    expect(isDeclining([90, 80, 70], 2)).toBe(true);
  });
  it("returns false with fewer than N+1 points", () => {
    expect(isDeclining([90, 80, 70])).toBe(false); // 3 pts, N=3 needs 4
    expect(isDeclining([100, 90])).toBe(false);
  });
});

describe("isCtrMismatch", () => {
  it("flags good position with far-below-benchmark CTR", () => {
    // position ~2.6 → benchmark ≈ 0.13; 0.013 is well under 60% of it.
    expect(isCtrMismatch(2.6, 0.013)).toBe(true);
  });
  it("does not flag healthy CTR at that position", () => {
    expect(isCtrMismatch(2.6, 0.14)).toBe(false);
  });
  it("does not flag poor positions", () => {
    expect(isCtrMismatch(15, 0.001)).toBe(false);
  });
});
