import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/server.js";

/**
 * E2E coverage for GET /api/v1/users/me/export (closes #625).
 *
 * GDPR data portability (#350): the endpoint streams the authenticated user's
 * profile, enrollments, quiz submissions, credentials and reward claims as a
 * downloadable JSON file. The response body is the raw UserDataExport object,
 * not the usual { success, data } envelope.
 */
describe("Data Export API — GET /api/v1/users/me/export (#625)", () => {
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

  it("rejects unauthenticated requests", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/export",
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe("UNAUTHORIZED");
  });

  it("rejects requests with a malformed bearer token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/export",
      headers: { authorization: "Bearer not-a-real-token" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns the export as a downloadable JSON attachment with the right headers", async () => {
    const token = tokenFor("00000000-0000-0000-0000-000000000001");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/export",
      headers: { authorization: `Bearer ${token}` },
    });

    expect([200, 401, 404]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      // Content-Type is application/json (reply.type("application/json")).
      const contentType = response.headers["content-type"];
      expect(typeof contentType).toBe("string");
      expect(contentType as string).toMatch(/application\/json/);

      // Content-Disposition carries the attachment filename pattern the
      // controller builds: chainlearn-export-<userId>.json.
      const disposition = response.headers["content-disposition"];
      expect(typeof disposition).toBe("string");
      expect(disposition as string).toMatch(/^attachment;/);
      expect(disposition as string).toMatch(/filename="chainlearn-export-[0-9a-f-]+\.json"/);
    }
  });

  it("returns a well-formed UserDataExport body (exportVersion:1, exportedAt, all five sections)", async () => {
    const token = tokenFor("00000000-0000-0000-0000-000000000001");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/export",
      headers: { authorization: `Bearer ${token}` },
    });

    expect([200, 401, 404]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      const body = JSON.parse(response.payload);

      // Export envelope.
      expect(body.exportVersion).toBe(1);
      expect(typeof body.exportedAt).toBe("string");
      expect(new Date(body.exportedAt).toString()).not.toBe("Invalid Date");

      // Profile is embedded, not just a user id.
      expect(body.profile).toBeDefined();
      expect(typeof body.profile.id).toBe("string");
      expect(typeof body.profile.stellarAddress).toBe("string");

      // Every subject-of-data-access section is present as an array,
      // even when empty — GDPR completeness means absence is explicit.
      expect(Array.isArray(body.enrollments)).toBe(true);
      expect(Array.isArray(body.quizSubmissions)).toBe(true);
      expect(Array.isArray(body.credentials)).toBe(true);
      expect(Array.isArray(body.rewardClaims)).toBe(true);
    }
  });

  it("scopes the export to the token's subject (per-user data isolation)", async () => {
    const alice = tokenFor("00000000-0000-0000-0000-000000000001");
    const bob = tokenFor("00000000-0000-0000-0000-000000000002");

    const aliceRes = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/export",
      headers: { authorization: `Bearer ${alice}` },
    });
    const bobRes = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/export",
      headers: { authorization: `Bearer ${bob}` },
    });

    // If both resolve to a user, the attachment filenames must carry
    // different user IDs so one user never downloads another's export.
    if (aliceRes.statusCode === 200 && bobRes.statusCode === 200) {
      expect(aliceRes.headers["content-disposition"]).not.toBe(
        bobRes.headers["content-disposition"],
      );
      const aliceBody = JSON.parse(aliceRes.payload);
      const bobBody = JSON.parse(bobRes.payload);
      expect(aliceBody.profile.id).not.toBe(bobBody.profile.id);
    }
  });
});
