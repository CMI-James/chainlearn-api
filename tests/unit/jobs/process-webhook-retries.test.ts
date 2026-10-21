import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * #611: startWebhookRetryProcessor/stopWebhookRetryProcessor is a thin
 * interval wrapper around webhook-dispatcher.js's processWebhookRetries(),
 * which does the actual ready-for-retry query, dispatch, and
 * success/failure bookkeeping against the database. This suite covers the
 * job wrapper itself: that it schedules on an interval, can be stopped
 * (including the "stop mid-flight, a tick already queued must not run"
 * case via the generation counter), and doesn't crash the process when the
 * underlying retry pass rejects.
 */

const mockProcessWebhookRetries = vi.fn();

vi.mock("../../../src/services/webhook-dispatcher.js", () => ({
  processWebhookRetries: mockProcessWebhookRetries,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const { startWebhookRetryProcessor, stopWebhookRetryProcessor } = await import(
  "../../../src/jobs/process-webhook-retries.js"
);
const { logger } = await import("../../../src/utils/logger.js");

const POLL_INTERVAL_MS = 60_000;

describe("process-webhook-retries job (#611)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockProcessWebhookRetries.mockResolvedValue(undefined);
  });

  afterEach(() => {
    stopWebhookRetryProcessor();
    vi.useRealTimers();
  });

  it("runs an immediate pass on start, before the first interval tick", async () => {
    await startWebhookRetryProcessor();

    expect(mockProcessWebhookRetries).toHaveBeenCalledOnce();
  });

  it("schedules the next pass on a 1 minute interval", async () => {
    await startWebhookRetryProcessor();
    mockProcessWebhookRetries.mockClear();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(mockProcessWebhookRetries).toHaveBeenCalledOnce();
  });

  it("is a no-op if already running", async () => {
    await startWebhookRetryProcessor();
    mockProcessWebhookRetries.mockClear();

    await startWebhookRetryProcessor();

    expect(mockProcessWebhookRetries).not.toHaveBeenCalled();
  });

  it("logs and does not throw when processWebhookRetries rejects", async () => {
    mockProcessWebhookRetries.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(startWebhookRetryProcessor()).resolves.not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Webhook retry processor tick failed"
    );
  });

  it("keeps polling on the interval even after a tick's pass rejected", async () => {
    mockProcessWebhookRetries.mockRejectedValueOnce(new Error("transient"));
    await startWebhookRetryProcessor();
    mockProcessWebhookRetries.mockClear();
    mockProcessWebhookRetries.mockResolvedValue(undefined);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(mockProcessWebhookRetries).toHaveBeenCalledOnce();
  });

  it("stops scheduling further passes once stopped", async () => {
    await startWebhookRetryProcessor();
    mockProcessWebhookRetries.mockClear();

    stopWebhookRetryProcessor();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);

    expect(mockProcessWebhookRetries).not.toHaveBeenCalled();
  });

  it("allows starting again after being stopped", async () => {
    await startWebhookRetryProcessor();
    stopWebhookRetryProcessor();
    mockProcessWebhookRetries.mockClear();

    await startWebhookRetryProcessor();

    expect(mockProcessWebhookRetries).toHaveBeenCalledOnce();
  });

  it("a tick already scheduled before stop() does not run after stop()", async () => {
    await startWebhookRetryProcessor();
    mockProcessWebhookRetries.mockClear();

    // Advance partway into the interval so a timer is pending, then stop.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    stopWebhookRetryProcessor();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockProcessWebhookRetries).not.toHaveBeenCalled();
  });

  it("stopping before starting (or stopping twice) does not throw", () => {
    expect(() => stopWebhookRetryProcessor()).not.toThrow();
    stopWebhookRetryProcessor();
    expect(() => stopWebhookRetryProcessor()).not.toThrow();
  });
});
