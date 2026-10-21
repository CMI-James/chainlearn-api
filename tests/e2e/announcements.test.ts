import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/server.js";
import { db } from "../../src/config/database.js";
import { announcements } from "../../src/database/schema.js";

describe("Public Announcements API (#353)", () => {
  let app: FastifyInstance;
  const createdIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(announcements).where(eq(announcements.id, id));
    }
    await app.close();
  });

  describe("GET /api/v1/announcements", () => {
    it("should not require authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/announcements",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should return a success envelope with a data array", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/announcements",
      });

      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("should include an active, unexpired announcement", async () => {
      const [row] = await db
        .insert(announcements)
        .values({
          title: "Public active announcement",
          message: "Visible to everyone",
          priority: "normal",
          active: true,
        })
        .returning();
      createdIds.push(row!.id);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/announcements",
      });

      const body = JSON.parse(response.payload);
      const found = body.data.find((a: { id: string }) => a.id === row!.id);
      expect(found).toBeDefined();
      expect(found.title).toBe("Public active announcement");
      expect(found.message).toBe("Visible to everyone");
    });

    it("should exclude an inactive announcement", async () => {
      const [row] = await db
        .insert(announcements)
        .values({
          title: "Inactive announcement",
          message: "Should not show",
          priority: "normal",
          active: false,
        })
        .returning();
      createdIds.push(row!.id);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/announcements",
      });

      const body = JSON.parse(response.payload);
      expect(body.data.some((a: { id: string }) => a.id === row!.id)).toBe(false);
    });

    it("should exclude an expired announcement", async () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60);
      const [row] = await db
        .insert(announcements)
        .values({
          title: "Expired announcement",
          message: "Should not show",
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

      const body = JSON.parse(response.payload);
      expect(body.data.some((a: { id: string }) => a.id === row!.id)).toBe(false);
    });

    it("should include an active announcement that expires in the future", async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24);
      const [row] = await db
        .insert(announcements)
        .values({
          title: "Future-expiring announcement",
          message: "Should show",
          priority: "normal",
          active: true,
          expiresAt: futureDate,
        })
        .returning();
      createdIds.push(row!.id);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/announcements",
      });

      const body = JSON.parse(response.payload);
      expect(body.data.some((a: { id: string }) => a.id === row!.id)).toBe(true);
    });

    it("should order announcements newest-first", async () => {
      const [older] = await db
        .insert(announcements)
        .values({
          title: "Older announcement",
          message: "msg",
          priority: "normal",
          active: true,
        })
        .returning();
      createdIds.push(older!.id);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const [newer] = await db
        .insert(announcements)
        .values({
          title: "Newer announcement",
          message: "msg",
          priority: "normal",
          active: true,
        })
        .returning();
      createdIds.push(newer!.id);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/announcements",
      });

      const body = JSON.parse(response.payload);
      const olderIndex = body.data.findIndex((a: { id: string }) => a.id === older!.id);
      const newerIndex = body.data.findIndex((a: { id: string }) => a.id === newer!.id);
      expect(newerIndex).toBeLessThan(olderIndex);
    });
  });
});
