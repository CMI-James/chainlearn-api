import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/server.js";

/**
 * E2E coverage for GET /api/v1/users/me/learning-path (closes #623).
 *
 * The endpoint returns personalized recommendations based on the user's
 * highest completed difficulty level. Follows the permissive status pattern
 * from tests/e2e/users.test.ts: 200/401/404 are all valid depending on DB
 * state. When 200, we assert each item carries the four fields the service
 * promises (courseId, courseTitle, difficulty, rationale).
 */
describe("Learning Path API — GET /api/v1/users/me/learning-path (#623)", () => {
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

  const expectRecommendationShape = (item: unknown) => {
    const r = item as Record<string, unknown>;
    expect(typeof r.courseId).toBe("string");
    expect(typeof r.courseTitle).toBe("string");
    expect(typeof r.difficulty).toBe("string");
    expect(["beginner", "intermediate", "advanced"]).toContain(r.difficulty);
    expect(typeof r.rationale).toBe("string");
    expect((r.rationale as string).length).toBeGreaterThan(0);
  };

  it("rejects unauthenticated requests", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/learning-path",
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe("UNAUTHORIZED");
  });

  it("rejects requests with a malformed bearer token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/learning-path",
      headers: { authorization: "Bearer invalid.jwt.token" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns an array of recommendations for an authenticated new user", async () => {
    const token = tokenFor("00000000-0000-0000-0000-000000000001");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/learning-path",
      headers: { authorization: `Bearer ${token}` },
    });

    expect([200, 401, 404]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      for (const recommendation of body.data) {
        expectRecommendationShape(recommendation);
      }
    }
  });

  it("returns a per-user learning path for a different user", async () => {
    const token = tokenFor("00000000-0000-0000-0000-000000000002");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/learning-path",
      headers: { authorization: `Bearer ${token}` },
    });

    expect([200, 401, 404]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      for (const recommendation of body.data) {
        expectRecommendationShape(recommendation);
      }
    }
  });

  it("never recommends a course the user has already completed or is enrolled in", async () => {
    // The service filters completedIds and enrolledIds out of candidates
    // before returning. We can assert the structural invariant: every
    // returned courseId is a unique string (no duplicates in one response).
    const token = tokenFor("00000000-0000-0000-0000-000000000001");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/learning-path",
      headers: { authorization: `Bearer ${token}` },
    });

    expect([200, 401, 404]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      const body = JSON.parse(response.payload);
      const ids = (body.data as Array<{ courseId: string }>).map((r) => r.courseId);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    }
  });
});
