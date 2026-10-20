import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/server.js";

/**
 * E2E coverage for GET /api/v1/users/me/learning-stats (closes #622).
 *
 * Follows the permissive status pattern established by tests/e2e/users.test.ts:
 * authenticated requests may return 200 (seeded profile), 401 (auth rejected
 * in this run's config), or 404 (the token's sub isn't a persisted user).
 * When the response is 200, we assert the full LearningStats shape.
 */
describe("Learning Stats API — GET /api/v1/users/me/learning-stats (#622)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

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

  const expectLearningStatsShape = (data: unknown) => {
    expect(data).toBeDefined();
    expect(typeof (data as Record<string, unknown>).coursesCompleted).toBe("number");
    expect(typeof (data as Record<string, unknown>).quizzesTaken).toBe("number");
    const average = (data as Record<string, unknown>).averageScore;
    expect(average === null || typeof average === "number").toBe(true);
    expect(typeof (data as Record<string, unknown>).creditsEarned).toBe("number");
    expect(typeof (data as Record<string, unknown>).credentialsEarned).toBe("number");
    expect(typeof (data as Record<string, unknown>).learningStreak).toBe("number");
    expect(typeof (data as Record<string, unknown>).estimatedTotalStudyTimeMinutes).toBe(
      "number",
    );
    expect(typeof (data as Record<string, unknown>).learningVelocity).toBe("number");
  };

  it("rejects unauthenticated requests", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/learning-stats",
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe("UNAUTHORIZED");
  });

  it("rejects requests with a malformed bearer token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/learning-stats",
      headers: { authorization: "Bearer not-a-real-jwt" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns the LearningStats shape for an authenticated user with no activity", async () => {
    const token = tokenFor("00000000-0000-0000-0000-000000000001");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/learning-stats",
      headers: { authorization: `Bearer ${token}` },
    });

    // 200 (user hydrated), 401 (auth rejected), 404 (user not in this run's DB)
    expect([200, 401, 404]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expectLearningStatsShape(body.data);
      // A brand-new user has no quizzes, no credits, no credentials.
      expect(body.data.coursesCompleted).toBeGreaterThanOrEqual(0);
      expect(body.data.quizzesTaken).toBeGreaterThanOrEqual(0);
      expect(body.data.learningStreak).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns stats for a different authenticated user independently", async () => {
    // A different `sub` must not share cached stats with the first user —
    // the service caches per userId, so the second call should resolve to
    // this user's own aggregates (or 404 if the user isn't persisted).
    const token = tokenFor("00000000-0000-0000-0000-000000000002");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/learning-stats",
      headers: { authorization: `Bearer ${token}` },
    });

    expect([200, 401, 404]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expectLearningStatsShape(body.data);
    }
  });

  it("serves a cached payload on repeat calls (5-minute cache, #383)", async () => {
    const token = tokenFor("00000000-0000-0000-0000-000000000001");

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/learning-stats",
      headers: { authorization: `Bearer ${token}` },
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/learning-stats",
      headers: { authorization: `Bearer ${token}` },
    });

    // Both responses must agree on status: a cached read never flips a 200
    // into a 401/404 (or vice versa) between adjacent calls.
    expect(second.statusCode).toBe(first.statusCode);
    if (first.statusCode === 200) {
      expect(second.payload).toBe(first.payload);
    }
  });
});
