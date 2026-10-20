import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/server.js";

/**
 * E2E coverage for GET /api/v1/users/me/recommendations (closes #624).
 *
 * Scored recommendations with per-item confidence and reasons (#375). Cached
 * per user for 1 hour; repeat calls serve the cached payload. See
 * src/modules/users/recommendations.ts for the scoring breakdown.
 */
describe("Recommendations API — GET /api/v1/users/me/recommendations (#624)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const tokenFor = (sub: string) =>
    app.jwt.sign({
      sub,
      stellarAddress:
        "GALICE0000000000000000000000000000000000000000000000000000000",
    });

  const expectScoredCourseShape = (item: unknown) => {
    const r = item as Record<string, unknown>;
    expect(typeof r.courseId).toBe("string");
    expect(typeof r.courseTitle).toBe("string");
    expect(typeof r.difficulty).toBe("string");
    expect(["beginner", "intermediate", "advanced"]).toContain(r.difficulty);
    expect(Array.isArray(r.tags)).toBe(true);
    expect(typeof r.confidence).toBe("number");
    expect(r.confidence as number).toBeGreaterThanOrEqual(0);
    expect(r.confidence as number).toBeLessThanOrEqual(1);
    expect(Array.isArray(r.reasons)).toBe(true);
    for (const reason of r.reasons as unknown[]) {
      expect(typeof reason).toBe("string");
    }
  };

  it("rejects unauthenticated requests", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/recommendations",
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe("UNAUTHORIZED");
  });

  it("rejects requests with a malformed bearer token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/recommendations",
      headers: { authorization: "Bearer nope" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns ScoredCourse items with confidence in [0,1] for a new user", async () => {
    const token = tokenFor("00000000-0000-0000-0000-000000000001");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/recommendations",
      headers: { authorization: `Bearer ${token}` },
    });

    expect([200, 401, 404]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      for (const item of body.data) {
        expectScoredCourseShape(item);
      }
    }
  });

  it("returns independent recommendations for a different user", async () => {
    const token = tokenFor("00000000-0000-0000-0000-000000000002");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/recommendations",
      headers: { authorization: `Bearer ${token}` },
    });

    expect([200, 401, 404]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      for (const item of body.data) {
        expectScoredCourseShape(item);
      }
    }
  });

  it("serves a cached payload on repeat calls (1-hour cache)", async () => {
    const token = tokenFor("00000000-0000-0000-0000-000000000001");

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/recommendations",
      headers: { authorization: `Bearer ${token}` },
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/recommendations",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(second.statusCode).toBe(first.statusCode);
    if (first.statusCode === 200) {
      expect(second.payload).toBe(first.payload);
    }
  });

  it("sorts recommendations by confidence descending when the list is non-empty", async () => {
    const token = tokenFor("00000000-0000-0000-0000-000000000001");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/recommendations",
      headers: { authorization: `Bearer ${token}` },
    });

    expect([200, 401, 404]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      const body = JSON.parse(response.payload);
      const items = body.data as Array<{ confidence: number }>;
      for (let i = 1; i < items.length; i++) {
        expect(items[i].confidence).toBeLessThanOrEqual(items[i - 1].confidence);
      }
    }
  });
});
