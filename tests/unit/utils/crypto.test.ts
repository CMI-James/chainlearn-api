import { describe, it, expect } from "vitest";
import { sha256Hash, safeEqual } from "../../../src/utils/crypto.js";

describe("sha256Hash", () => {
  it("returns a 64-character lowercase hex string", () => {
    const hash = sha256Hash("hello world");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    expect(sha256Hash("same input")).toBe(sha256Hash("same input"));
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256Hash("input-a")).not.toBe(sha256Hash("input-b"));
  });

  it("matches the known SHA-256 digest for an empty string", () => {
    expect(sha256Hash("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes unicode input without throwing", () => {
    expect(() => sha256Hash("ünïcode 🚀")).not.toThrow();
    expect(sha256Hash("ünïcode 🚀")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("safeEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("secret-token", "secret-token")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(safeEqual("secret-token", "secret-tokeX")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(safeEqual("short", "a-much-longer-string")).toBe(false);
  });

  it("returns false when one string is a prefix of the other", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("returns false for strings that only differ by trailing NUL bytes", () => {
    // Regression guard: zero-padding the shorter buffer for the
    // constant-time comparison must not make "abc" and "abc\0" compare
    // equal just because their padded buffers happen to match.
    expect(safeEqual("abc", "abc\0")).toBe(false);
    expect(safeEqual("abc\0", "abc")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(safeEqual("", "")).toBe(true);
  });

  it("returns false comparing an empty string to a non-empty one", () => {
    expect(safeEqual("", "a")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(safeEqual("Secret", "secret")).toBe(false);
  });
});
