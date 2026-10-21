import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/server.js";
import { db } from "../../src/config/database.js";
import { users, courses, enrollments, badges, userBadges } from "../../src/database/schema.js";

describe("Admin Badge Management API (#380)", () => {
  let app: FastifyInstance;

  const adminUserId = "b1c2d3e4-1111-4ef8-bb6d-6bb9bd380d10";
  const adminStellarAddress = "GADMINBADGE00000000000000000000000000000000000000000000".slice(
    0,
    56,
  );
  const nonAdminUserId = "b1c2d3e4-2222-4ef8-bb6d-6bb9bd380d10";
  const nonAdminStellarAddress =
    "GNONADMINBADGE000000000000000000000000000000000000000000".slice(0, 56);

  const createdBadgeIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    await db
      .insert(users)
      .values({
        id: adminUserId,
        stellarAddress: adminStellarAddress,
        displayName: "Badge Admin",
        isAdmin: true,
      })
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        id: nonAdminUserId,
        stellarAddress: nonAdminStellarAddress,
        displayName: "Badge Non-Admin",
        isAdmin: false,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    for (const id of createdBadgeIds) {
      await db.delete(userBadges).where(eq(userBadges.badgeId, id));
      await db.delete(badges).where(eq(badges.id, id));
    }
    await db.delete(users).where(eq(users.id, adminUserId));
    await db.delete(users).where(eq(users.id, nonAdminUserId));
    await app.close();
  });

  const adminToken = () =>
    app.jwt.sign({ sub: adminUserId, stellarAddress: adminStellarAddress });

  const nonAdminToken = () =>
    app.jwt.sign({ sub: nonAdminUserId, stellarAddress: nonAdminStellarAddress });

  describe("auth", () => {
    it("should reject unauthenticated requests", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/badges",
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject non-admin users with 403", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/badges",
        headers: { authorization: `Bearer ${nonAdminToken()}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe("badge CRUD", () => {
    it("should create a badge", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/badges",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          name: "First Steps",
          description: "Enroll in your first course",
          iconUrl: "https://example.com/first-steps.png",
          type: "enrollment",
          criteria: { count: 1 },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("First Steps");
      expect(body.data.type).toBe("enrollment");
      createdBadgeIds.push(body.data.id);
    });

    it("should reject creation with a missing required field", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/badges",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { name: "Incomplete badge" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject an invalid badge type", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/badges",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          name: "Bad Type",
          description: "desc",
          iconUrl: "https://example.com/icon.png",
          type: "not_a_real_type",
          criteria: { count: 1 },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should list all badges", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/badges",
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.some((b: { id: string }) => createdBadgeIds.includes(b.id))).toBe(true);
    });

    it("should get a badge by id", async () => {
      const [badge] = await db
        .insert(badges)
        .values({
          name: "Gettable Badge",
          description: "desc",
          iconUrl: "https://example.com/icon.png",
          type: "enrollment",
          criteria: { count: 1 },
        })
        .returning();
      createdBadgeIds.push(badge!.id);

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/admin/badges/${badge!.id}`,
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.id).toBe(badge!.id);
    });

    it("should 404 for a non-existent badge id", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/badges/00000000-0000-0000-0000-000000000000",
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should update a badge", async () => {
      const [badge] = await db
        .insert(badges)
        .values({
          name: "Original Name",
          description: "Original description",
          iconUrl: "https://example.com/icon.png",
          type: "enrollment",
          criteria: { count: 1 },
        })
        .returning();
      createdBadgeIds.push(badge!.id);

      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/badges/${badge!.id}`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { name: "Renamed Badge" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.name).toBe("Renamed Badge");
      expect(body.data.description).toBe("Original description");
    });

    it("should 404 when updating a non-existent badge", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/badges/00000000-0000-0000-0000-000000000000",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { name: "Does not exist" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should delete a badge", async () => {
      const [badge] = await db
        .insert(badges)
        .values({
          name: "To Delete",
          description: "desc",
          iconUrl: "https://example.com/icon.png",
          type: "enrollment",
          criteria: { count: 1 },
        })
        .returning();

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/badges/${badge!.id}`,
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(200);

      const remaining = await db.select().from(badges).where(eq(badges.id, badge!.id));
      expect(remaining.length).toBe(0);
    });

    it("should 404 when deleting a non-existent badge", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/admin/badges/00000000-0000-0000-0000-000000000000",
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("badge assignment and progress tracking", () => {
    // Badges have no admin "assign" endpoint — they're evaluated and
    // auto-awarded against a user's real activity on every call to
    // GET /users/me/badges (badge.service.ts's evaluateUserBadges()), which
    // is the actual assignment mechanism. Covering it here via the badge
    // this suite creates through the admin API above, end to end.
    const holderUserId = "b1c2d3e4-3333-4ef8-bb6d-6bb9bd380d10";
    const holderStellarAddress =
      "GBADGEHOLDER0000000000000000000000000000000000000000000".slice(0, 56);
    const courseId = "b1c2d3e4-4444-4ef8-bb6d-6bb9bd380d10";

    const holderToken = () =>
      app.jwt.sign({ sub: holderUserId, stellarAddress: holderStellarAddress });

    it("tracks progress toward an admin-created badge before it's earned", async () => {
      await db
        .insert(users)
        .values({
          id: holderUserId,
          stellarAddress: holderStellarAddress,
          displayName: "Badge Holder",
        })
        .onConflictDoNothing();

      await db
        .insert(courses)
        .values({
          id: courseId,
          title: "Badge Assignment Test Course",
          description: "For #613 tests",
          difficulty: "beginner",
          isActive: true,
        })
        .onConflictDoNothing();

      const createResponse = await app.inject({
        method: "POST",
        url: "/api/v1/admin/badges",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          name: "Enroll in 2 Courses",
          description: "Enroll in at least 2 courses",
          iconUrl: "https://example.com/icon.png",
          type: "enrollment",
          criteria: { count: 2 },
        },
      });
      const badgeId = JSON.parse(createResponse.payload).data.id;
      createdBadgeIds.push(badgeId);

      await db
        .insert(enrollments)
        .values({ userId: holderUserId, courseId })
        .onConflictDoNothing();

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users/me/badges",
        headers: { authorization: `Bearer ${holderToken()}` },
      });

      const body = JSON.parse(response.payload);
      const found = body.data.unearned.find((b: { id: string }) => b.id === badgeId);
      expect(found).toBeDefined();
      expect(found.progress.current).toBe(1);
      expect(found.progress.target).toBe(2);
    });

    it("auto-assigns the badge once its criteria are met, and the admin API still reports it as a real badge", async () => {
      const createResponse = await app.inject({
        method: "POST",
        url: "/api/v1/admin/badges",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          name: "Enroll in 1 Course (assignment test)",
          description: "Enroll in at least 1 course",
          iconUrl: "https://example.com/icon.png",
          type: "enrollment",
          criteria: { count: 1 },
        },
      });
      const badgeId = JSON.parse(createResponse.payload).data.id;
      createdBadgeIds.push(badgeId);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users/me/badges",
        headers: { authorization: `Bearer ${holderToken()}` },
      });

      const body = JSON.parse(response.payload);
      const earned = body.data.earned.find((b: { id: string }) => b.id === badgeId);
      expect(earned).toBeDefined();
      expect(earned.earnedAt).toBeDefined();

      // The admin API's view of the same badge is unaffected by it having
      // been earned by a user — it's still just the definition.
      const adminGetResponse = await app.inject({
        method: "GET",
        url: `/api/v1/admin/badges/${badgeId}`,
        headers: { authorization: `Bearer ${adminToken()}` },
      });
      expect(adminGetResponse.statusCode).toBe(200);
      expect(JSON.parse(adminGetResponse.payload).data.id).toBe(badgeId);
    });
  });
});
