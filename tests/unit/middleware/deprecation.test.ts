import { describe, it, expect, vi } from "vitest";

/**
 * #583: deprecationHeader(version, sunsetDate) is a preHandler factory that
 * attaches RFC 8594 Deprecation/Sunset/Link headers to a response. It is
 * attached per-route by whoever wires up a deprecated endpoint; confirmed
 * via a repo-wide search that no route currently does, so there is no
 * "endpoint matching" logic to test beyond the factory itself — each call
 * site decides which endpoint gets deprecated by whether it attaches this
 * preHandler at all.
 */

import { deprecationHeader } from "../../../src/middleware/deprecation.js";

function buildReply() {
  const headers: Record<string, string> = {};
  const reply = {
    header: vi.fn((name: string, value: string) => {
      headers[name] = value;
      return reply;
    }),
  };
  return { reply, headers };
}

describe("deprecationHeader (#583)", () => {
  it("sets the Deprecation header to 'true' (RFC 8594)", async () => {
    const { reply, headers } = buildReply();
    const handler = deprecationHeader("1", "2026-12-31T00:00:00Z");

    await handler(
      {} as any,
      reply as any,
    );

    expect(headers["Deprecation"]).toBe("true");
  });

  it("sets the Sunset header as an HTTP-date (RFC 8594)", async () => {
    const { reply, headers } = buildReply();
    const handler = deprecationHeader("1", "2026-12-31T00:00:00Z");

    await handler({} as any, reply as any);

    expect(headers["Sunset"]).toBe(new Date("2026-12-31T00:00:00Z").toUTCString());
    // RFC 7231 HTTP-date format, e.g. "Thu, 31 Dec 2026 00:00:00 GMT"
    expect(headers["Sunset"]).toMatch(
      /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/
    );
  });

  it("points the Link header's successor-version at version + 1", async () => {
    const { reply, headers } = buildReply();
    const handler = deprecationHeader("1", "2026-12-31T00:00:00Z");

    await handler({} as any, reply as any);

    expect(headers["Link"]).toBe('</api/v2>; rel="successor-version"');
  });

  it("computes the correct successor version for a two-digit version string", async () => {
    const { reply, headers } = buildReply();
    const handler = deprecationHeader("9", "2026-12-31T00:00:00Z");

    await handler({} as any, reply as any);

    expect(headers["Link"]).toBe('</api/v10>; rel="successor-version"');
  });

  it("produces a far-future Sunset header unchanged for any valid ISO date input", async () => {
    const { reply, headers } = buildReply();
    const handler = deprecationHeader("2", "2030-01-15T12:30:00Z");

    await handler({} as any, reply as any);

    expect(headers["Sunset"]).toBe(new Date("2030-01-15T12:30:00Z").toUTCString());
  });

  it("sets all three headers on every call, independent of request contents", async () => {
    const { reply, headers } = buildReply();
    const handler = deprecationHeader("1", "2026-06-01T00:00:00Z");

    await handler({ method: "POST", url: "/api/v1/anything" } as any, reply as any);

    expect(Object.keys(headers).sort()).toEqual(["Deprecation", "Link", "Sunset"]);
  });
});
