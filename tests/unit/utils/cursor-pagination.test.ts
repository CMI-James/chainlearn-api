import { describe, it, expect } from "vitest";
import { encodeCursor, decodeCursor } from "../../../src/utils/cursor-pagination.js";

describe("cursor-pagination (#482)", () => {
  it("round-trips a (createdAt, id) pair through encode/decode", () => {
    const row = { createdAt: new Date("2026-01-15T10:30:00.000Z"), id: "abc-123" };
    const cursor = encodeCursor(row);
    const decoded = decodeCursor(cursor);

    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(row.id);
    expect(decoded!.createdAt.toISOString()).toBe(row.createdAt.toISOString());
  });

  it("produces an opaque, URL-safe string", () => {
    const cursor = encodeCursor({ createdAt: new Date(), id: "x" });
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it("returns null for garbage input instead of throwing", () => {
    expect(decodeCursor("not-a-real-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("returns null for a validly-encoded but wrong-shaped payload", () => {
    const cursor = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8").toString("base64url");
    expect(decodeCursor(cursor)).toBeNull();
  });

  it("returns null when createdAt isn't a valid date string", () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: "not-a-date", id: "abc" }),
      "utf8",
    ).toString("base64url");
    expect(decodeCursor(cursor)).toBeNull();
  });

  it("returns null when id is present but not a string (#594)", () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: new Date().toISOString(), id: 12345 }),
      "utf8",
    ).toString("base64url");
    expect(decodeCursor(cursor)).toBeNull();
  });

  it("returns null when createdAt is present but not a string (#594)", () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: 1700000000000, id: "abc" }),
      "utf8",
    ).toString("base64url");
    expect(decodeCursor(cursor)).toBeNull();
  });

  it("returns null for a JSON array instead of an object (#594)", () => {
    const cursor = Buffer.from(JSON.stringify(["createdAt", "id"]), "utf8").toString("base64url");
    expect(decodeCursor(cursor)).toBeNull();
  });

  it("returns null for a JSON primitive instead of an object (#594)", () => {
    const cursor = Buffer.from(JSON.stringify("just a string"), "utf8").toString("base64url");
    expect(decodeCursor(cursor)).toBeNull();
  });

  it("still decodes successfully when the payload has extra unexpected fields (#594)", () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: new Date("2026-01-15T10:30:00.000Z").toISOString(), id: "abc", extra: "ignored" }),
      "utf8",
    ).toString("base64url");
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe("abc");
  });

  it("round-trips an id containing special characters (#594)", () => {
    const row = { createdAt: new Date("2026-01-15T10:30:00.000Z"), id: "id/with+special=chars&more" };
    const decoded = decodeCursor(encodeCursor(row));
    expect(decoded!.id).toBe(row.id);
  });

  it("round-trips distinct cursors for two rows sharing the same createdAt, differing only by id (#594)", () => {
    const createdAt = new Date("2026-01-15T10:30:00.000Z");
    const cursorA = encodeCursor({ createdAt, id: "a" });
    const cursorB = encodeCursor({ createdAt, id: "b" });

    expect(cursorA).not.toBe(cursorB);
    expect(decodeCursor(cursorA)!.id).toBe("a");
    expect(decodeCursor(cursorB)!.id).toBe("b");
  });

  it("round-trips a cursor at the Unix epoch boundary (#594)", () => {
    const row = { createdAt: new Date(0), id: "epoch" };
    const decoded = decodeCursor(encodeCursor(row));
    expect(decoded!.createdAt.toISOString()).toBe(row.createdAt.toISOString());
  });
});
