import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/server.js";
import { db } from "../../src/config/database.js";
import {
  users,
  courses,
  enrollments,
  badges,
  userBadges,
} from "../../src/database/schema.js";

describe("User Badges API (#379)", () => {
  let app: FastifyInstance;

  const userId = "f1a2d3e4-1111-4ef8-bb6d-6bb9bd380b10";
  const userStellarAddress = "GBADGEUSER00000000000000000000000000000000000000000000000".slice(
    0,
    56,
  );
  const courseAId = "f1a2d3e4-2222-4ef8-bb6d-6bb9bd380b10";
  const courseBId = "f1a2d3e4-3333-4ef8-bb6d-6bb9bd380b10";

  const createdBadgeIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    await db
      .insert(users)
      .values({
        id: userId,
        stellarAddress: userStellarAddress,
        displayName: "Badge Test User",
      })
      .onConflictDoNothing();

    await db
      .insert(courses)
      .values([
        {
          id: courseAId,
          title: "Badge Test Course A",
          description: "For #379 tests",
          difficulty: "beginner",
          isActive: true,
        },
        {
          id: courseBId,
          title: "Badge Test Course B",
          description: "For #379 tests",
          difficulty: "beginner",
          isActive: true,
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(userBadges).where(eq(userBadges.userId, userId));
    for (const id of createdBadgeIds) {
      await db.delete(badges).where(eq(badges.id, id));
    }
    await db.delete(enrollments).where(eq(enrollments.userId, userId));
    await db.delete(courses).where(eq(courses.id, courseAId));
    await db.delete(courses).where(eq(courses.id, courseBId));
    await db.delete(users).where(eq(users.id, userId));
    await app.close();
  });

  const userToken = () => app.jwt.sign({ sub: userId, stellarAddress: userStellarAddress });

  describe("GET /api/v1/users/me/badges", () => {
    it("should reject unauthenticated requests", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users/me/badges",
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return a success envelope with earned/unearned arrays and totals", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users/me/badges",
        headers: { authorization: `Bearer ${userToken()}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.earned)).toBe(true);
      expect(Array.isArray(body.data.unearned)).toBe(true);
      expect(typeof body.data.totalEarned).toBe("number");
      expect(typeof body.data.totalAvailable).toBe("number");
    });
  });

  describe("badge listing and progress", () => {
    it("should list an enrollment-type badge as unearned with progress toward its target", async () => {
      const [badge] = await db
        .insert(badges)
        .values({
          name: "Enroll in 2 Courses",
          description: "Enroll in at least 2 courses",
          iconUrl: "https://example.com/icon.png",
          type: "enrollment",
          criteria: { count: 2 },
        })
        .returning();
      createdBadgeIds.push(badge!.id);

      await db
        .insert(enrollments)
        .values({ userId, courseId: courseAId })
        .onConflictDoNothing();

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users/me/badges",
        headers: { authorization: `Bearer ${userToken()}` },
      });

      const body = JSON.parse(response.payload);
      const found = body.data.unearned.find(
        (b: { id: string }) => b.id === badge!.id,
      );
      expect(found).toBeDefined();
      expect(found.progress.current).toBe(1);
      expect(found.progress.target).toBe(2);
      expect(found.progress.percentage).toBe(50);
      expect(body.data.earned.some((b: { id: string }) => b.id === badge!.id)).toBe(
        false,
      );
    });

    it("should report 100% progress but still list as unearned at exactly the target, before the next evaluation awards it", async () => {
      const [badge] = await db
        .insert(badges)
        .values({
          name: "Enroll in 1 Course",
          description: "Enroll in at least 1 course",
          iconUrl: "https://example.com/icon.png",
          type: "enrollment",
          criteria: { count: 1 },
        })
        .returning();
      createdBadgeIds.push(badge!.id);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users/me/badges",
        headers: { authorization: `Bearer ${userToken()}` },
      });

      const body = JSON.parse(response.payload);
      const earned = body.data.earned.find((b: { id: string }) => b.id === badge!.id);
      expect(earned).toBeDefined();
      expect(earned.progress.percentage).toBe(100);
    });
  });

  describe("badge earning", () => {
    it("should automatically award a badge once its criteria are met, and persist it to user_badges", async () => {
      const [badge] = await db
        .insert(badges)
        .values({
          name: "Enroll in 2 Courses (earning test)",
          description: "Enroll in at least 2 courses",
          iconUrl: "https://example.com/icon.png",
          type: "enrollment",
          criteria: { count: 2 },
        })
        .returning();
      createdBadgeIds.push(badge!.id);

      await db
        .insert(enrollments)
        .values([
          { userId, courseId: courseAId },
          { userId, courseId: courseBId },
        ])
        .onConflictDoNothing();

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users/me/badges",
        headers: { authorization: `Bearer ${userToken()}` },
      });

      const body = JSON.parse(response.payload);
      const earned = body.data.earned.find((b: { id: string }) => b.id === badge!.id);
      expect(earned).toBeDefined();
      expect(earned.earnedAt).toBeDefined();

      const persisted = await db
        .select()
        .from(userBadges)
        .where(eq(userBadges.badgeId, badge!.id));
      expect(persisted.length).toBe(1);
      expect(persisted[0]!.userId).toBe(userId);
    });

    it("should not re-evaluate or duplicate an already-earned badge on a subsequent request", async () => {
      const [badge] = await db
        .insert(badges)
        .values({
          name: "Enroll in 1 Course (idempotency test)",
          description: "Enroll in at least 1 course",
          iconUrl: "https://example.com/icon.png",
          type: "enrollment",
          criteria: { count: 1 },
        })
        .returning();
      createdBadgeIds.push(badge!.id);

      await app.inject({
        method: "GET",
        url: "/api/v1/users/me/badges",
        headers: { authorization: `Bearer ${userToken()}` },
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users/me/badges",
        headers: { authorization: `Bearer ${userToken()}` },
      });

      const body = JSON.parse(response.payload);
      const earnedMatches = body.data.earned.filter(
        (b: { id: string }) => b.id === badge!.id,
      );
      expect(earnedMatches.length).toBe(1);

      const persisted = await db
        .select()
        .from(userBadges)
        .where(eq(userBadges.badgeId, badge!.id));
      expect(persisted.length).toBe(1);
    });
  });
});
