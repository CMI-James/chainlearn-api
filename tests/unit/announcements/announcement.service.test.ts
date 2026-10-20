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
  announcements: { id: "id", active: "active", expiresAt: "expiresAt", createdAt: "createdAt" },
}));
vi.mock("../../../src/audit/index.js", () => ({ auditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

const { AnnouncementService } = await import(
  "../../../src/modules/announcements/announcement.service.js"
);

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides = {}) {
  return {
    id: "ann-1",
    title: "Maintenance window",
    message: "We will be down for 10 minutes",
    priority: "high",
    active: true,
    createdAt: new Date("2024-06-01T00:00:00Z"),
    expiresAt: null,
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("AnnouncementService", () => {
  let service: InstanceType<typeof AnnouncementService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AnnouncementService();
  });

  // ── listActive ────────────────────────────────────────────────────────────

  describe("listActive()", () => {
    it("returns active, non-expired announcements", async () => {
      const row = makeRow();
      mockDb.select.mockReturnValueOnce(makeChain([row]));

      const result = await service.listActive();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("ann-1");
      expect(result[0].active).toBe(true);
    });

    it("returns an empty array when no active announcements exist", async () => {
      mockDb.select.mockReturnValueOnce(makeChain([]));

      const result = await service.listActive();

      expect(result).toHaveLength(0);
    });
  });

  // ── listAll ───────────────────────────────────────────────────────────────

  describe("listAll()", () => {
    it("returns paginated results with total count", async () => {
      const row = makeRow({ active: false });
      mockDb.select
        .mockReturnValueOnce(makeChain([{ value: 3 }]))
        .mockReturnValueOnce(makeChain([row]));

      const result = await service.listAll({ page: 1, limit: 10 });

      expect(result.total).toBe(3);
      expect(result.announcements).toHaveLength(1);
    });

    it("applies correct offset for page 2", async () => {
      mockDb.select
        .mockReturnValueOnce(makeChain([{ value: 10 }]))
        .mockReturnValueOnce(makeChain([]));

      await service.listAll({ page: 2, limit: 5 });

      const rowChain = mockDb.select.mock.results[1].value;
      expect(rowChain.offset).toHaveBeenCalledWith(5);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe("create()", () => {
    it("inserts the announcement and logs an audit event", async () => {
      const row = makeRow();
      const { auditLog } = await import("../../../src/audit/index.js");
      mockDb.insert.mockReturnValue(makeChain([row]));

      const result = await service.create({
        title: "Maintenance window",
        message: "We will be down for 10 minutes",
        priority: "high",
        active: true,
        expiresAt: undefined,
      });

      expect(result.id).toBe("ann-1");
      expect(auditLog).toHaveBeenCalledWith(
        "announcement.created",
        expect.objectContaining({ announcementId: "ann-1" }),
      );
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe("update()", () => {
    it("returns the updated announcement", async () => {
      const row = makeRow({ title: "Updated title" });
      mockDb.update.mockReturnValue(makeChain([row]));

      const result = await service.update("ann-1", { title: "Updated title" });

      expect(result.title).toBe("Updated title");
    });

    it("throws NotFoundError when announcement does not exist", async () => {
      mockDb.update.mockReturnValue(makeChain([]));

      await expect(service.update("missing", { title: "x" })).rejects.toThrow(NotFoundError);
    });
  });
});
