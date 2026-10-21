import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/server.js";
import { db } from "../../src/config/database.js";
import { users, courses } from "../../src/database/schema.js";

describe("Admin Course Management API (#292)", () => {
  let app: FastifyInstance;

  const adminUserId = "a1c2d3e4-1111-4ef8-bb6d-6bb9bd380c10";
  const adminStellarAddress = "GADMINCOURSE0000000000000000000000000000000000000000000".slice(
    0,
    56,
  );
  const nonAdminUserId = "a1c2d3e4-2222-4ef8-bb6d-6bb9bd380c10";
  const nonAdminStellarAddress =
    "GNONADMINCOURSE000000000000000000000000000000000000000000".slice(0, 56);

  const createdCourseIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    await db
      .insert(users)
      .values({
        id: adminUserId,
        stellarAddress: adminStellarAddress,
        displayName: "Course Admin",
        isAdmin: true,
      })
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        id: nonAdminUserId,
        stellarAddress: nonAdminStellarAddress,
        displayName: "Course Non-Admin",
        isAdmin: false,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    for (const id of createdCourseIds) {
      await db.delete(courses).where(eq(courses.id, id));
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
        method: "POST",
        url: "/api/v1/admin/courses",
        payload: { title: "x", description: "x" },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject non-admin users with 403", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/courses",
        headers: { authorization: `Bearer ${nonAdminToken()}` },
        payload: { title: "x", description: "x" },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe("course CRUD", () => {
    it("should create a course", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/courses",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          title: "Intro to Stellar",
          description: "Learn the basics of the Stellar network.",
          difficulty: "beginner",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe("Intro to Stellar");
      expect(body.data.isActive).toBe(true);
      createdCourseIds.push(body.data.id);
    });

    it("should reject creation with a missing required field", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/courses",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "No description" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should update a course", async () => {
      const [course] = await db
        .insert(courses)
        .values({ title: "Original title", description: "Original description" })
        .returning();
      createdCourseIds.push(course!.id);

      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/courses/${course!.id}`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "Updated title" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.title).toBe("Updated title");
      expect(body.data.description).toBe("Original description");
    });

    it("should 404 when updating a non-existent course", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/courses/00000000-0000-0000-0000-000000000000",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "Does not exist" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should soft-delete a course", async () => {
      const [course] = await db
        .insert(courses)
        .values({ title: "To delete", description: "Will be deactivated", isActive: true })
        .returning();
      createdCourseIds.push(course!.id);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/courses/${course!.id}`,
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(200);

      const [reloaded] = await db.select().from(courses).where(eq(courses.id, course!.id));
      expect(reloaded!.isActive).toBe(false);
    });
  });

  describe("module management", () => {
    it("should create a module for a course", async () => {
      const [course] = await db
        .insert(courses)
        .values({ title: "Module Test Course", description: "For module tests" })
        .returning();
      createdCourseIds.push(course!.id);

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/courses/${course!.id}/modules`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "Module 1", description: "First module" },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe("Module 1");
    });

    it("should update a module", async () => {
      const [course] = await db
        .insert(courses)
        .values({ title: "Module Update Course", description: "For module update tests" })
        .returning();
      createdCourseIds.push(course!.id);

      const createResponse = await app.inject({
        method: "POST",
        url: `/api/v1/admin/courses/${course!.id}/modules`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "Original Module", description: "desc" },
      });
      const moduleId = JSON.parse(createResponse.payload).data.id;

      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/courses/${course!.id}/modules/${moduleId}`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "Renamed Module" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.title).toBe("Renamed Module");
    });

    it("should delete a module", async () => {
      const [course] = await db
        .insert(courses)
        .values({ title: "Module Delete Course", description: "For module delete tests" })
        .returning();
      createdCourseIds.push(course!.id);

      const createResponse = await app.inject({
        method: "POST",
        url: `/api/v1/admin/courses/${course!.id}/modules`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "Doomed Module", description: "desc" },
      });
      const moduleId = JSON.parse(createResponse.payload).data.id;

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/courses/${course!.id}/modules/${moduleId}`,
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("content management", () => {
    it("should create a text content item within a module", async () => {
      const [course] = await db
        .insert(courses)
        .values({ title: "Content Test Course", description: "For content tests" })
        .returning();
      createdCourseIds.push(course!.id);

      const moduleResponse = await app.inject({
        method: "POST",
        url: `/api/v1/admin/courses/${course!.id}/modules`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "Content Module", description: "desc" },
      });
      const moduleId = JSON.parse(moduleResponse.payload).data.id;

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/courses/${course!.id}/modules/${moduleId}/content`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          title: "Lesson text",
          type: "text",
          content: { body: "Welcome to the lesson." },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe("Lesson text");
    });

    it("should list content items for a module", async () => {
      const [course] = await db
        .insert(courses)
        .values({ title: "Content List Course", description: "For content list tests" })
        .returning();
      createdCourseIds.push(course!.id);

      const moduleResponse = await app.inject({
        method: "POST",
        url: `/api/v1/admin/courses/${course!.id}/modules`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "Listing Module", description: "desc" },
      });
      const moduleId = JSON.parse(moduleResponse.payload).data.id;

      await app.inject({
        method: "POST",
        url: `/api/v1/admin/courses/${course!.id}/modules/${moduleId}/content`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          title: "Lesson text",
          type: "text",
          content: { body: "Content body." },
        },
      });

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/admin/courses/${course!.id}/modules/${moduleId}/content`,
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it("should delete a content item", async () => {
      const [course] = await db
        .insert(courses)
        .values({ title: "Content Delete Course", description: "For content delete tests" })
        .returning();
      createdCourseIds.push(course!.id);

      const moduleResponse = await app.inject({
        method: "POST",
        url: `/api/v1/admin/courses/${course!.id}/modules`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "Deletable Content Module", description: "desc" },
      });
      const moduleId = JSON.parse(moduleResponse.payload).data.id;

      const contentResponse = await app.inject({
        method: "POST",
        url: `/api/v1/admin/courses/${course!.id}/modules/${moduleId}/content`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          title: "Doomed content",
          type: "text",
          content: { body: "Will be deleted." },
        },
      });
      const contentId = JSON.parse(contentResponse.payload).data.id;

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/courses/${course!.id}/modules/${moduleId}/content/${contentId}`,
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("course publishing", () => {
    it("publish-check should report a brand-new course as not ready (no modules yet)", async () => {
      const [course] = await db
        .insert(courses)
        .values({ title: "Unready Course", description: "Has no modules" })
        .returning();
      createdCourseIds.push(course!.id);

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/courses/${course!.id}/publish-check`,
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.ready).toBe(false);
      expect(
        body.data.issues.some((issue: { field: string }) => issue.field === "modules"),
      ).toBe(true);
    });

    it("should reject publishing a course that fails its readiness check", async () => {
      const [course] = await db
        .insert(courses)
        .values({ title: "Cannot Publish Yet", description: "Has no modules" })
        .returning();
      createdCourseIds.push(course!.id);

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/courses/${course!.id}/publish`,
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should archive a course", async () => {
      const [course] = await db
        .insert(courses)
        .values({ title: "To Archive", description: "Will be archived", isActive: true })
        .returning();
      createdCourseIds.push(course!.id);

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/courses/${course!.id}/archive`,
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(200);
      const [reloaded] = await db.select().from(courses).where(eq(courses.id, course!.id));
      expect(reloaded!.isActive).toBe(false);
      expect(reloaded!.archivedAt).not.toBeNull();
    });
  });
});
