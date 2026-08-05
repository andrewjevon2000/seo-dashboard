import { describe, it, expect } from "vitest";
import { normalizeUrl, normalizePath, pathOf } from "./normalize";

describe("normalizeUrl", () => {
  it("forces https", () => {
    expect(normalizeUrl("http://verihubs.com/blog/kyc")).toBe("https://verihubs.com/blog/kyc");
  });

  it("strips www and lowercases host", () => {
    expect(normalizeUrl("https://WWW.Verihubs.com/Blog")).toBe("https://verihubs.com/Blog");
  });

  it("preserves path case", () => {
    expect(normalizeUrl("https://verihubs.com/Blog/KYC-Guide")).toBe(
      "https://verihubs.com/Blog/KYC-Guide",
    );
  });

  it("strips trailing slash but keeps root as host-only", () => {
    expect(normalizeUrl("https://verihubs.com/blog/kyc/")).toBe("https://verihubs.com/blog/kyc");
    expect(normalizeUrl("https://verihubs.com/")).toBe("https://verihubs.com");
    expect(normalizeUrl("https://verihubs.com")).toBe("https://verihubs.com");
  });

  it("drops query params and UTM", () => {
    expect(normalizeUrl("https://verihubs.com/blog/kyc?utm_source=news&x=1")).toBe(
      "https://verihubs.com/blog/kyc",
    );
  });

  it("drops the fragment", () => {
    expect(normalizeUrl("https://verihubs.com/blog/kyc#section")).toBe(
      "https://verihubs.com/blog/kyc",
    );
  });

  it("drops default ports", () => {
    expect(normalizeUrl("https://verihubs.com:443/blog")).toBe("https://verihubs.com/blog");
    expect(normalizeUrl("http://verihubs.com:80/blog")).toBe("https://verihubs.com/blog");
  });

  it("accepts scheme-less input from the sheet", () => {
    expect(normalizeUrl("verihubs.com/blog/kyc/")).toBe("https://verihubs.com/blog/kyc");
    expect(normalizeUrl("//verihubs.com/blog")).toBe("https://verihubs.com/blog");
  });

  it("is idempotent", () => {
    const once = normalizeUrl("http://WWW.verihubs.com/Blog/KYC/?utm=1#a");
    expect(normalizeUrl(once)).toBe(once);
  });

  it("returns trimmed original on unparseable input", () => {
    expect(normalizeUrl("  not a url  ")).toBe("not a url");
  });
});

describe("normalizePath / pathOf", () => {
  it("normalizes a bare GA4-style path to match a URL path", () => {
    expect(normalizePath("/blog/kyc/")).toBe("/blog/kyc");
    expect(normalizePath("blog/kyc")).toBe("/blog/kyc");
    expect(normalizePath("/blog/kyc?x=1#h")).toBe("/blog/kyc");
    expect(normalizePath("/")).toBe("/");
  });

  it("extracts a normalized path from a full URL", () => {
    expect(pathOf("https://verihubs.com/blog/kyc/")).toBe("/blog/kyc");
    expect(pathOf(normalizeUrl("http://www.verihubs.com/Blog/"))).toBe("/Blog");
  });
});
