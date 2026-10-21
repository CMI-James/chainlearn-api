import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/server.js";
import { db } from "../../src/config/database.js";
import { users, announcements } from "../../src/database/schema.js";

describe("Admin Announcement Management API (#353)", () => {
  let app: FastifyInstance;

  const adminUserId = "e1a2d3e4-1111-4ef8-bb6d-6bb9bd380a90";
  const adminStellarAddress = "GANNOUNCEADMIN0000000000000000000000000000000000000000000".slice(
    0,
    56,
  );
  const nonAdminUserId = "e1a2d3e4-2222-4ef8-bb6d-6bb9bd380a90";
  const nonAdminStellarAddress =
    "GANNOUNCENONADMIN00000000000000000000000000000000000000000".slice(0, 56);

  const createdIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    await db
      .insert(users)
      .values({
        id: adminUserId,
        stellarAddress: adminStellarAddress,
        displayName: "Announcement Admin",
        isAdmin: true,
      })
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        id: nonAdminUserId,
        stellarAddress: nonAdminStellarAddress,
        displayName: "Announcement Non-Admin",
        isAdmin: false,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(announcements).where(eq(announcements.id, id));
    }
    await db.delete(users).where(eq(users.id, adminUserId));
    await db.delete(users).where(eq(users.id, nonAdminUserId));
    await app.close();
  });

  const adminToken = () =>
    app.jwt.sign({ sub: adminUserId, stellarAddress: adminStellarAddress });

  const nonAdminToken = () =>
    app.jwt.sign({ sub: nonAdminUserId, stellarAddress: nonAdminStellarAddress });

  describe("CRUD operations", () => {
    it("should reject unauthenticated requests to list", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/announcements",
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject non-admin users with 403", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/announcements",
        headers: { authorization: `Bearer ${nonAdminToken()}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should create an announcement", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/announcements",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          title: "Scheduled maintenance",
          message: "The platform will be briefly unavailable.",
          priority: "high",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe("Scheduled maintenance");
      expect(body.data.priority).toBe("high");
      createdIds.push(body.data.id);
    });

    it("should reject creation with a missing required field", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/announcements",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "No message" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should list all announcements, paginated", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/announcements",
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(typeof body.pagination.page).toBe("number");
      expect(typeof body.pagination.limit).toBe("number");
      expect(typeof body.pagination.total).toBe("number");
      expect(body.data.some((a: { id: string }) => createdIds.includes(a.id))).toBe(true);
    });

    it("should respect limit when listing", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/announcements?page=1&limit=1",
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.length).toBe(1);
      expect(body.pagination.limit).toBe(1);
    });

    it("should update an announcement", async () => {
      const [row] = await db
        .insert(announcements)
        .values({ title: "Original title", message: "Original message", priority: "normal" })
        .returning();
      createdIds.push(row!.id);

      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/announcements/${row!.id}`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "Updated title" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.title).toBe("Updated title");
      expect(body.data.message).toBe("Original message");
    });

    it("should 404 when updating a non-existent announcement", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/announcements/00000000-0000-0000-0000-000000000000",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { title: "Does not exist" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should delete an announcement", async () => {
      const [row] = await db
        .insert(announcements)
        .values({ title: "To delete", message: "Will be removed", priority: "normal" })
        .returning();

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/announcements/${row!.id}`,
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(204);

      const remaining = await db
        .select()
        .from(announcements)
        .where(eq(announcements.id, row!.id));
      expect(remaining.length).toBe(0);
    });

    it("should 404 when deleting a non-existent announcement", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/admin/announcements/00000000-0000-0000-0000-000000000000",
        headers: { authorization: `Bearer ${adminToken()}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("activation / deactivation", () => {
    it("should deactivate an active announcement via PUT active=false", async () => {
      const [row] = await db
        .insert(announcements)
        .values({ title: "Active now", message: "msg", priority: "normal", active: true })
        .returning();
      createdIds.push(row!.id);

      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/announcements/${row!.id}`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { active: false },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.active).toBe(false);

      const [reloaded] = await db
        .select()
        .from(announcements)
        .where(eq(announcements.id, row!.id));
      expect(reloaded!.active).toBe(false);
    });

    it("should reactivate a deactivated announcement via PUT active=true", async () => {
      const [row] = await db
        .insert(announcements)
        .values({ title: "Inactive now", message: "msg", priority: "normal", active: false })
        .returning();
      createdIds.push(row!.id);

      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/announcements/${row!.id}`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { active: true },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.active).toBe(true);
    });

    it("a deactivated announcement should not appear in the public feed", async () => {
      const [row] = await db
        .insert(announcements)
        .values({
          title: "Deactivated, should be hidden",
          message: "msg",
          priority: "normal",
          active: false,
        })
        .returning();
      createdIds.push(row!.id);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/announcements",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.some((a: { id: string }) => a.id === row!.id)).toBe(false);
    });
  });

  describe("expiration", () => {
    it("should allow setting an expiresAt in the future", async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
      const [row] = await db
        .insert(announcements)
        .values({ title: "Expires later", message: "msg", priority: "normal", active: true })
        .returning();
      createdIds.push(row!.id);

      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/announcements/${row!.id}`,
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { expiresAt: futureDate },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(new Date(body.data.expiresAt).toISOString()).toBe(futureDate);
    });

    it("an already-expired announcement should not appear in the public feed", async () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24);
      const [row] = await db
        .insert(announcements)
        .values({
          title: "Already expired",
          message: "msg",
          priority: "normal",
          active: true,
          expiresAt: pastDate,
        })
        .returning();
      createdIds.push(row!.id);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/announcements",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.some((a: { id: string }) => a.id === row!.id)).toBe(false);
    });

    it("an active announcement with no expiresAt should appear in the public feed", async () => {
      const [row] = await db
        .insert(announcements)
        .values({
          title: "Never expires",
          message: "msg",
          priority: "normal",
          active: true,
          expiresAt: null,
        })
        .returning();
      createdIds.push(row!.id);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/announcements",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.some((a: { id: string }) => a.id === row!.id)).toBe(true);
    });
  });
});
