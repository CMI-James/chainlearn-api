import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * #609: startIdempotencyCleanup/stopIdempotencyCleanup is a thin interval
 * wrapper around middleware/idempotency.js's cleanupIdempotencyKeys(), which
 * already has its own deletion-logic tests in
 * tests/unit/services/idempotency.test.ts. This suite covers the job
 * wrapper itself: that it schedules on an interval, can be stopped, and
 * doesn't crash the process when the underlying cleanup rejects.
 */

const mockCleanupIdempotencyKeys = vi.fn();

vi.mock("../../../src/middleware/idempotency.js", () => ({
  cleanupIdempotencyKeys: mockCleanupIdempotencyKeys,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

const { startIdempotencyCleanup, stopIdempotencyCleanup } = await import(
  "../../../src/jobs/cleanup-idempotency.js"
);
const { logger } = await import("../../../src/utils/logger.js");

describe("cleanup-idempotency job (#609)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockCleanupIdempotencyKeys.mockResolvedValue(0);
  });

  afterEach(() => {
    stopIdempotencyCleanup();
    vi.useRealTimers();
  });

  it("schedules cleanup on an hourly interval", async () => {
    startIdempotencyCleanup();

    expect(mockCleanupIdempotencyKeys).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(mockCleanupIdempotencyKeys).toHaveBeenCalledOnce();
  });

  it("runs again on the next interval tick", async () => {
    startIdempotencyCleanup();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(mockCleanupIdempotencyKeys).toHaveBeenCalledTimes(2);
  });

  it("logs the deleted count when keys were actually deleted", async () => {
    mockCleanupIdempotencyKeys.mockResolvedValue(5);
    startIdempotencyCleanup();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(logger.info).toHaveBeenCalledWith(
      { deleted: 5 },
      "Cleaned up expired idempotency keys"
    );
  });

  it("does not log when nothing was deleted", async () => {
    mockCleanupIdempotencyKeys.mockResolvedValue(0);
    startIdempotencyCleanup();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs and does not throw when cleanupIdempotencyKeys rejects", async () => {
    mockCleanupIdempotencyKeys.mockRejectedValue(new Error("db unavailable"));
    startIdempotencyCleanup();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to clean up idempotency keys"
    );
  });

  it("stops scheduling further runs once stopped", async () => {
    startIdempotencyCleanup();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockCleanupIdempotencyKeys).toHaveBeenCalledTimes(1);

    stopIdempotencyCleanup();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockCleanupIdempotencyKeys).toHaveBeenCalledTimes(1);
  });

  it("stopping before starting (or stopping twice) does not throw", () => {
    expect(() => stopIdempotencyCleanup()).not.toThrow();

    startIdempotencyCleanup();
    stopIdempotencyCleanup();
    expect(() => stopIdempotencyCleanup()).not.toThrow();
  });
});
