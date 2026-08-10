import { describe, it, expect } from "vitest";
import {
  toFraction,
  slugify,
  draftUrl,
  plannedUrl,
  siteFindingUrl,
  monthRange,
  windowEnding,
  parseCsvLine,
  RISK_CONFIDENCE,
  VERDICT_ACTION,
  isVerdict,
} from "./store-helpers";

describe("toFraction (CTR scaling — guards a past bug)", () => {
  it("passes through a fraction unchanged", () => {
    expect(toFraction(0.035)).toBeCloseTo(0.035);
    expect(toFraction(0)).toBe(0);
    expect(toFraction(1)).toBe(1); // exactly 1 (100% CTR) is a valid fraction
  });
  it("converts a percent (>1) to a fraction", () => {
    expect(toFraction(26.2548)).toBeCloseTo(0.262548);
    expect(toFraction(3.5)).toBeCloseTo(0.035);
    expect(toFraction(100)).toBe(1);
  });
  it("collapses negatives and non-finite to 0", () => {
    expect(toFraction(-5)).toBe(0);
    expect(toFraction(NaN)).toBe(0);
    expect(toFraction(Infinity)).toBe(0);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Apa Itu KYC?")).toBe("apa-itu-kyc");
  });
  it("trims leading/trailing separators", () => {
    expect(slugify("--Hello, World--")).toBe("hello-world");
  });
  it("falls back to 'unknown' for empty", () => {
    expect(slugify("")).toBe("unknown");
    expect(slugify("!!!")).toBe("unknown");
  });
  it("truncates to maxLen", () => {
    expect(slugify("a".repeat(100), 10)).toHaveLength(10);
  });
});

describe("URL markers", () => {
  it("draftUrl", () => {
    expect(draftUrl("artikel-kyc-ph.html")).toBe("https://verihubs.com/__draft__/artikel-kyc-ph-html");
  });
  it("plannedUrl", () => {
    expect(plannedUrl("apa itu kyc")).toBe("https://verihubs.com/__planned__/apa-itu-kyc");
  });
  it("siteFindingUrl combines category + issue", () => {
    expect(siteFindingUrl("anchor-risk", "exact-match >10%")).toContain("__site__/anchor-risk-exact-match");
  });
});

describe("monthRange", () => {
  it("handles a 31-day month", () => {
    expect(monthRange("2026-07")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });
  it("handles a 30-day month", () => {
    expect(monthRange("2026-06")).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });
  it("handles non-leap February (28)", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("handles leap February (29)", () => {
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });
  it("handles December", () => {
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("rejects a bad month", () => {
    expect(() => monthRange("2026-13")).toThrow();
    expect(() => monthRange("2026")).toThrow();
  });
});

describe("windowEnding", () => {
  it("builds an inclusive 7-day window", () => {
    expect(windowEnding(new Date("2026-08-17T00:00:00Z"))).toEqual({ from: "2026-08-11", to: "2026-08-17" });
  });
  it("crosses a month boundary correctly", () => {
    expect(windowEnding(new Date("2026-08-03T00:00:00Z"))).toEqual({ from: "2026-07-28", to: "2026-08-03" });
  });
});

describe("parseCsvLine", () => {
  it("splits a simple line", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });
  it("respects quoted fields containing commas", () => {
    expect(parseCsvLine('url,"Title, with comma",id')).toEqual(["url", "Title, with comma", "id"]);
  });
  it("keeps a trailing empty field", () => {
    expect(parseCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });
});

describe("verdict + risk maps", () => {
  it("maps every verdict to a changelog action", () => {
    for (const v of ["create", "refresh", "merge", "redirect", "prune", "leave"]) {
      expect(VERDICT_ACTION[v]).toBeTruthy();
    }
    expect(VERDICT_ACTION.merge).toBe("merged");
    expect(VERDICT_ACTION.redirect).toBe("redirected");
  });
  it("maps risk levels to confidence", () => {
    expect(RISK_CONFIDENCE.HIGH).toBe("0.9");
    expect(RISK_CONFIDENCE.SAFE).toBe("0.85");
  });
  it("isVerdict validates the enum", () => {
    expect(isVerdict("merge")).toBe(true);
    expect(isVerdict("delete")).toBe(false);
    expect(isVerdict(null)).toBe(false);
  });
});
