import { describe, test, expect, vi, beforeEach } from "vitest";
import { NotFoundError } from "../../src/utils/errors.js";

// ── mock db ──────────────────────────────────────────────────────────────────
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
  },
}));

// ── mock revokeToken ──────────────────────────────────────────────────────────
const mockRevokeToken = vi.fn();
vi.mock("../../src/middleware/auth.js", () => ({
  revokeToken: mockRevokeToken,
}));

// ── mock logger ───────────────────────────────────────────────────────────────
vi.mock("../../src/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

// ── import SUT after mocks ────────────────────────────────────────────────────
import { SessionService } from "../../src/modules/auth/session.service.js";

// ── helpers ───────────────────────────────────────────────────────────────────
function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    userId: "user-1",
    tokenId: "tok-1",
    deviceInfo: "Mozilla/5.0",
    ipAddress: "127.0.0.1",
    lastActive: new Date("2024-01-01"),
    createdAt: new Date("2024-01-01"),
    revokedAt: null,
    ...overrides,
  };
}

/** Fluent builder so each db method returns the next chained call. */
function buildSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

function buildInsertChain() {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };
  return chain;
}

function buildUpdateChain() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("SessionService (#574)", () => {
  let svc: SessionService;

  beforeEach(() => {
    svc = new SessionService();
    vi.clearAllMocks();
  });

  // ── track ──────────────────────────────────────────────────────────────────
  describe("track", () => {
    test("upserts session row with correct userId and tokenId", async () => {
      const chain = buildInsertChain();
      mockInsert.mockReturnValue(chain);

      await svc.track("user-1", "tok-1", "Chrome", "1.2.3.4");

      expect(mockInsert).toHaveBeenCalledOnce();
      expect(chain.values).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1", tokenId: "tok-1" }),
      );
      expect(chain.onConflictDoUpdate).toHaveBeenCalledOnce();
    });

    test("swallows db errors so a tracking failure never rejects", async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockRejectedValue(new Error("DB down")),
        }),
      });

      // Must not throw
      await expect(
        svc.track("user-1", "tok-1", null, null),
      ).resolves.toBeUndefined();
    });

    test("accepts null deviceInfo and ipAddress", async () => {
      const chain = buildInsertChain();
      mockInsert.mockReturnValue(chain);

      await svc.track("user-1", "tok-1", null, null);

      expect(chain.values).toHaveBeenCalledWith(
        expect.objectContaining({ deviceInfo: null, ipAddress: null }),
      );
    });
  });

  // ── listSessions ───────────────────────────────────────────────────────────
  describe("listSessions", () => {
    test("returns mapped SessionSummary array for active sessions", async () => {
      const row = makeSession();
      mockSelect.mockReturnValue(buildSelectChain([row]));

      const result = await svc.listSessions("user-1", "tok-1");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "sess-1",
        deviceInfo: "Mozilla/5.0",
        ipAddress: "127.0.0.1",
        current: true,
      });
    });

    test("marks session as current when tokenId matches currentTokenId", async () => {
      const rows = [makeSession({ tokenId: "tok-current" }), makeSession({ id: "sess-2", tokenId: "tok-other" })];
      mockSelect.mockReturnValue(buildSelectChain(rows));

      const result = await svc.listSessions("user-1", "tok-current");

      expect(result[0].current).toBe(true);
      expect(result[1].current).toBe(false);
    });

    test("marks no session as current when currentTokenId is undefined", async () => {
      mockSelect.mockReturnValue(buildSelectChain([makeSession()]));

      const result = await svc.listSessions("user-1");

      expect(result[0].current).toBe(false);
    });

    test("returns empty array when user has no active sessions", async () => {
      mockSelect.mockReturnValue(buildSelectChain([]));

      const result = await svc.listSessions("user-1");

      expect(result).toEqual([]);
    });
  });

  // ── revokeSession ──────────────────────────────────────────────────────────
  describe("revokeSession", () => {
    test("marks session revoked and calls revokeToken with correct tokenId", async () => {
      const row = makeSession();
      mockSelect.mockReturnValue(buildSelectChain([row]));
      mockUpdate.mockReturnValue(buildUpdateChain());
      mockRevokeToken.mockResolvedValue(undefined);

      await svc.revokeSession("user-1", "sess-1");

      expect(mockUpdate).toHaveBeenCalledOnce();
      expect(mockRevokeToken).toHaveBeenCalledWith("tok-1", expect.any(Number));
    });

    test("throws NotFoundError when session does not exist", async () => {
      mockSelect.mockReturnValue(buildSelectChain([]));

      await expect(svc.revokeSession("user-1", "sess-missing")).rejects.toThrow(
        NotFoundError,
      );
    });

    test("throws NotFoundError when session is already revoked", async () => {
      const revoked = makeSession({ revokedAt: new Date("2024-01-02") });
      mockSelect.mockReturnValue(buildSelectChain([revoked]));

      await expect(svc.revokeSession("user-1", "sess-1")).rejects.toThrow(
        NotFoundError,
      );
    });

    test("does not call revokeToken when session is not found", async () => {
      mockSelect.mockReturnValue(buildSelectChain([]));

      await expect(svc.revokeSession("user-1", "sess-x")).rejects.toThrow();
      expect(mockRevokeToken).not.toHaveBeenCalled();
    });
  });
});
