import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../src/utils/request-context.js", () => ({
  getRequestId: vi.fn(() => "req-123"),
}));

const { mockListCourses } = vi.hoisted(() => ({ mockListCourses: vi.fn() }));
vi.mock("../../../src/modules/courses/course.service.js", () => ({
  courseService: { listCourses: mockListCourses },
}));

import { warmCourseCache } from "../../../src/cache/warmer.js";
import { logger } from "../../../src/utils/logger.js";

describe("warmCourseCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("warms page 1 (including the initial probe fetch) when the total fits within a single page", async () => {
    mockListCourses.mockResolvedValue({ courses: [], total: 5 });

    await warmCourseCache();

    // The initial fetch (to learn `total`) and the page-1 loop iteration
    // both request page 1 — this is the function's actual behavior, not a
    // regression; the fetch is cheap and the page is served from cache the
    // second time.
    expect(mockListCourses).toHaveBeenCalledTimes(2);
    for (const call of mockListCourses.mock.calls) {
      expect(call).toEqual([null, { page: 1, limit: 20 }]);
    }
  });

  it("warms every page of the listing, not just page 1", async () => {
    // total=45 at limit=20 => 3 pages (20, 20, 5), plus the initial probe fetch of page 1
    mockListCourses.mockResolvedValue({ courses: [], total: 45 });

    await warmCourseCache();

    expect(mockListCourses).toHaveBeenCalledTimes(4);
    expect(mockListCourses).toHaveBeenNthCalledWith(1, null, { page: 1, limit: 20 }); // initial probe
    expect(mockListCourses).toHaveBeenNthCalledWith(2, null, { page: 1, limit: 20 }); // loop page 1
    expect(mockListCourses).toHaveBeenNthCalledWith(3, null, { page: 2, limit: 20 });
    expect(mockListCourses).toHaveBeenNthCalledWith(4, null, { page: 3, limit: 20 });
  });

  it("warms at least one page even when there are zero courses", async () => {
    mockListCourses.mockResolvedValue({ courses: [], total: 0 });

    await warmCourseCache();

    expect(mockListCourses).toHaveBeenCalledTimes(2);
    for (const call of mockListCourses.mock.calls) {
      expect(call).toEqual([null, { page: 1, limit: 20 }]);
    }
  });

  it("calls listCourses with userId=null so warming bypasses any per-user enrollment data", async () => {
    mockListCourses.mockResolvedValue({ courses: [], total: 10 });

    await warmCourseCache();

    for (const call of mockListCourses.mock.calls) {
      expect(call[0]).toBeNull();
    }
  });

  it("logs a success message with the number of pages warmed", async () => {
    mockListCourses.mockResolvedValue({ courses: [], total: 45 });

    await warmCourseCache();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req-123", pagesWarmed: 3 }),
      expect.stringContaining("successfully warmed"),
    );
  });

  it("catches errors from the initial listCourses call and logs them without throwing", async () => {
    mockListCourses.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(warmCourseCache()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        requestId: "req-123",
      }),
      expect.stringContaining("failed"),
    );
  });

  it("catches errors raised partway through the warming loop and logs them without throwing", async () => {
    // First call is the initial probe fetch (succeeds); second call is the
    // loop's page-1 iteration, which fails.
    mockListCourses
      .mockResolvedValueOnce({ courses: [], total: 45 })
      .mockRejectedValueOnce(new Error("timeout warming page 1"));

    await expect(warmCourseCache()).resolves.toBeUndefined();

    // Stopped after the failure — did not attempt pages 2 or 3.
    expect(mockListCourses).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("failed"),
    );
  });

  it("never rejects, regardless of failure mode", async () => {
    mockListCourses.mockRejectedValue("non-Error rejection value");

    await expect(warmCourseCache()).resolves.toBeUndefined();
  });
});
