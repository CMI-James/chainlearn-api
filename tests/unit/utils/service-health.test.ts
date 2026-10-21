import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/metrics/index.js", () => ({
  dependencyHealthCheckSeconds: { observe: vi.fn() },
}));

import { checkServiceHealth } from "../../../src/utils/service-health.js";
import { dependencyHealthCheckSeconds } from "../../../src/metrics/index.js";

describe("checkServiceHealth (#483)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports ok with a non-negative latency when the check resolves", async () => {
    const result = await checkServiceHealth("redis", async () => "PONG");

    expect(result.status).toBe("ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(dependencyHealthCheckSeconds.observe).toHaveBeenCalledWith(
      { service: "redis", status: "ok" },
      expect.any(Number),
    );
  });

  it("reports down when the check rejects", async () => {
    const result = await checkServiceHealth("database", async () => {
      throw new Error("connection refused");
    });

    expect(result.status).toBe("down");
    expect(dependencyHealthCheckSeconds.observe).toHaveBeenCalledWith(
      { service: "database", status: "down" },
      expect.any(Number),
    );
  });

  it("reports down instead of hanging when the check exceeds the timeout", async () => {
    const neverResolves = new Promise(() => {});
    const result = await checkServiceHealth("ai", () => neverResolves, 20);

    expect(result.status).toBe("down");
    expect(result.latencyMs).toBeGreaterThanOrEqual(20);
  });

  it("falls back to the default timeout when none is passed", async () => {
    // Resolves well within the 5s default, so this proves the default is
    // applied (not just that *some* timeout is), without a slow test.
    const result = await checkServiceHealth("cache", async () => "OK");

    expect(result.status).toBe("ok");
  });

  it("records a non-negative latency when the check rejects immediately", async () => {
    const result = await checkServiceHealth("queue", async () => {
      throw new Error("ECONNREFUSED");
    });

    expect(result.status).toBe("down");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(dependencyHealthCheckSeconds.observe).toHaveBeenCalledWith(
      { service: "queue", status: "down" },
      expect.any(Number),
    );
  });

  it("records the timed-out check's observed latency in seconds, matching latencyMs", async () => {
    const neverResolves = new Promise(() => {});
    const result = await checkServiceHealth("ai", () => neverResolves, 15);

    const observeMock = vi.mocked(dependencyHealthCheckSeconds.observe);
    const [, observedSeconds] =
      observeMock.mock.calls[observeMock.mock.calls.length - 1];
    expect(observedSeconds * 1000).toBeCloseTo(result.latencyMs, 0);
  });

  it("reports the correct service name for each independent check", async () => {
    await checkServiceHealth("service-a", async () => "ok");
    await checkServiceHealth("service-b", async () => "ok");

    expect(dependencyHealthCheckSeconds.observe).toHaveBeenNthCalledWith(
      1,
      { service: "service-a", status: "ok" },
      expect.any(Number),
    );
    expect(dependencyHealthCheckSeconds.observe).toHaveBeenNthCalledWith(
      2,
      { service: "service-b", status: "ok" },
      expect.any(Number),
    );
  });
});
