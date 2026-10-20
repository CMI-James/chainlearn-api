import { describe, it, expect, vi, beforeEach } from "vitest";

// Must be hoisted above the service import so the module mock is in place.
vi.mock("../../../src/config/database.js", () => {
  const select = vi.fn();
  return { db: { select } };
});

vi.mock("../../../src/cache/index.js", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheKey: (...parts: (string | number)[]) => parts.join(":"),
}));

import { db } from "../../../src/config/database.js";
import { cacheGet, cacheSet } from "../../../src/cache/index.js";
import { DashboardService } from "../../../src/modules/admin/dashboard.service.js";

// Helper: make db.select().from().where() return a single-row result.
function mockSelect(value: unknown) {
  const chain = { from: vi.fn(), where: vi.fn(), then: undefined as unknown };
  chain.from.mockReturnValue(chain);
  chain.where.mockResolvedValue([value]);
  chain.from.mockResolvedValue([value]);
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

// Build a chain that resolves to `value` for any chained call.
function makeChain(value: unknown) {
  const c: Record<string, unknown> = {};
  const resolve = vi.fn().mockResolvedValue([value]);
  c.from = resolve;
  c.where = resolve;
  return c;
}

describe("DashboardService", () => {
  let service: DashboardService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DashboardService();
  });

  it("returns cached stats when cache is warm", async () => {
    const cached = { totalUsers: 42, generatedAt: new Date().toISOString() };
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cached);

    const result = await service.getStats();

    expect(result).toBe(cached);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("queries the database when cache is cold and writes result to cache", async () => {
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    // db.select is called 11 times; each must return a chain that resolves.
    const row = { value: 10 };
    const submissionRow = { total: 20, graded: 15 };
    const rewardRow = { value: 500 };

    let callCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const val =
        callCount === 9
          ? submissionRow
          : callCount === 11
            ? rewardRow
            : row;
      return makeChain(val);
    });

    const stats = await service.getStats();

    expect(stats.totalUsers).toBe(10);
    expect(stats.totalEnrollments).toBe(10);
    expect(stats.totalCredentials).toBe(10);
    expect(stats.totalRewardsClaimed).toBe(500);
    expect(stats.quizCompletionRate).toBe(75); // 15/20 * 100
    expect(cacheSet).toHaveBeenCalledOnce();
    expect(typeof stats.generatedAt).toBe("string");
  });

  it("computes quizCompletionRate as 0 when there are no submissions", async () => {
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const row = { value: 0 };
    const submissionRow = { total: 0, graded: 0 };
    const rewardRow = { value: 0 };
    let callCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const val =
        callCount === 9 ? submissionRow : callCount === 11 ? rewardRow : row;
      return makeChain(val);
    });

    const stats = await service.getStats();
    expect(stats.quizCompletionRate).toBe(0);
  });

  it("computes trend changePercent correctly", async () => {
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    // newThisWeek = 20, newPrevWeek = 10 → changePercent = 100
    // enrollThisWeek = 5, enrollPrevWeek = 10 → changePercent = -50
    let callCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      // calls: 1=totalUsers, 2=newToday, 3=newThisWeek, 4=newPrevWeek,
      //        5=newMonth, 6=totalEnroll, 7=enrollThisWeek, 8=enrollPrevWeek,
      //        9=submissions, 10=credentials, 11=rewards
      const val =
        callCount === 3
          ? { value: 20 }
          : callCount === 4
            ? { value: 10 }
            : callCount === 7
              ? { value: 5 }
              : callCount === 8
                ? { value: 10 }
                : callCount === 9
                  ? { total: 0, graded: 0 }
                  : callCount === 11
                    ? { value: 0 }
                    : { value: 0 };
      return makeChain(val);
    });

    const stats = await service.getStats();
    expect(stats.trends.newUsers.changePercent).toBe(100);
    expect(stats.trends.enrollments.changePercent).toBe(-50);
  });

  it("returns changePercent null when previous period is 0", async () => {
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const row = { value: 0 };
    let callCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const val =
        callCount === 3
          ? { value: 5 }
          : callCount === 9
            ? { total: 0, graded: 0 }
            : callCount === 11
              ? { value: 0 }
              : row;
      return makeChain(val);
    });

    const stats = await service.getStats();
    // newPrevWeek = 0 → changePercent must be null
    expect(stats.trends.newUsers.changePercent).toBeNull();
  });
});
