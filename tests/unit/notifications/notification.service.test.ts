import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError } from "../../../src/utils/errors.js";

// ── db mock ───────────────────────────────────────────────────────────────────

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.offset = vi.fn().mockReturnValue(chain);
  chain.set = vi.fn().mockReturnValue(chain);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(result);
  // Promise-like so `await db.select()...` resolves to the result array
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const mockDb = {
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
};

vi.mock("../../../src/config/database.js", () => ({ db: mockDb }));
vi.mock("../../../src/database/schema.js", () => ({
  notifications: { userId: "userId", id: "id", read: "read", createdAt: "createdAt" },
}));

// ── import after mocks ────────────────────────────────────────────────────────

const { NotificationService } = await import(
  "../../../src/modules/notifications/notification.service.js"
);

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides = {}) {
  return {
    id: "notif-1",
    userId: "user-1",
    type: "badge",
    title: "Well done",
    message: "You earned a badge",
    read: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("NotificationService", () => {
  let service: InstanceType<typeof NotificationService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NotificationService();
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns paginated notifications with total and unread count", async () => {
      const row = makeRow();
      // Three parallel queries: total count, unread count, rows
      mockDb.select
        .mockReturnValueOnce(makeChain([{ value: 5 }]))   // total
        .mockReturnValueOnce(makeChain([{ value: 2 }]))   // unread
        .mockReturnValueOnce(makeChain([row]));            // rows

      const result = await service.list("user-1", { page: 1, limit: 10 });

      expect(result.total).toBe(5);
      expect(result.unreadCount).toBe(2);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0].id).toBe("notif-1");
    });

    it("returns empty page when user has no notifications", async () => {
      mockDb.select
        .mockReturnValueOnce(makeChain([{ value: 0 }]))
        .mockReturnValueOnce(makeChain([{ value: 0 }]))
        .mockReturnValueOnce(makeChain([]));

      const result = await service.list("user-empty", { page: 1, limit: 10 });

      expect(result.total).toBe(0);
      expect(result.unreadCount).toBe(0);
      expect(result.notifications).toHaveLength(0);
    });

    it("calculates offset from page and limit", async () => {
      mockDb.select
        .mockReturnValueOnce(makeChain([{ value: 20 }]))
        .mockReturnValueOnce(makeChain([{ value: 5 }]))
        .mockReturnValueOnce(makeChain([]));

      await service.list("user-1", { page: 3, limit: 5 });

      // Third select chain's .offset() must have been called with 10 (page 3, limit 5 → offset 10)
      const thirdSelectChain = mockDb.select.mock.results[2].value;
      expect(thirdSelectChain.offset).toHaveBeenCalledWith(10);
    });
  });

  // ── markRead ──────────────────────────────────────────────────────────────

  describe("markRead()", () => {
    it("returns the updated notification when found", async () => {
      const row = makeRow({ read: true });
      const chain = makeChain([row]);
      mockDb.update.mockReturnValue(chain);

      const result = await service.markRead("user-1", "notif-1");

      expect(result.read).toBe(true);
      expect(result.id).toBe("notif-1");
    });

    it("throws NotFoundError when the notification does not belong to the user", async () => {
      const chain = makeChain([]);
      mockDb.update.mockReturnValue(chain);

      await expect(service.markRead("user-1", "other-notif")).rejects.toThrow(NotFoundError);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe("create()", () => {
    it("inserts and returns the new notification", async () => {
      const row = makeRow();
      const chain = makeChain([row]);
      mockDb.insert.mockReturnValue(chain);

      const result = await service.create({
        userId: "user-1",
        type: "badge",
        title: "Well done",
        message: "You earned a badge",
      });

      expect(result.id).toBe("notif-1");
      expect(result.type).toBe("badge");
    });

    it("throws a validation error when title exceeds 255 characters", async () => {
      await expect(
        service.create({
          userId: "user-1",
          type: "badge",
          title: "x".repeat(256),
          message: "ok",
        }),
      ).rejects.toThrow();
    });

    it("throws a validation error when message exceeds 5000 characters", async () => {
      await expect(
        service.create({
          userId: "user-1",
          type: "badge",
          title: "ok",
          message: "x".repeat(5001),
        }),
      ).rejects.toThrow();
    });

    it("throws a validation error when type is empty", async () => {
      await expect(
        service.create({ userId: "user-1", type: "", title: "ok", message: "ok" }),
      ).rejects.toThrow();
    });
  });
});
