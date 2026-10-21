import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  registry,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  stellarTxDurationSeconds,
  quizSubmissionsTotal,
  rewardClaimsTotal,
  credentialsMintedTotal,
  dependencyHealthCheckSeconds,
  setupInfraMetrics,
} from "../../../src/metrics/index.js";

// prom-client's `Counter`/`Histogram` typings omit the `name` field even though
// the metric instances carry it at runtime, so read it through a widened type.
const metricName = (metric: unknown): string => (metric as { name: string }).name;

async function metricJson(name: string) {
  const metrics = await registry.getMetricsAsJSON();
  return metrics.find((m) => m.name === name);
}

describe("Metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.resetMetrics();
  });

  it("should have httpRequestsTotal counter", () => {
    expect(httpRequestsTotal).toBeDefined();
    expect(metricName(httpRequestsTotal)).toBe("http_requests_total");
  });

  it("should have httpRequestDurationSeconds histogram", () => {
    expect(httpRequestDurationSeconds).toBeDefined();
    expect(metricName(httpRequestDurationSeconds)).toBe("http_request_duration_seconds");
  });

  it("should increment request counter", () => {
    httpRequestsTotal.inc({ method: "GET", route: "/health", status_code: "200" });

    const metrics = registry.getSingleMetric("http_requests_total");
    expect(metrics).toBeDefined();
  });

  it("should record request duration", () => {
    httpRequestDurationSeconds.observe(
      { method: "GET", route: "/health", status_code: "200" },
      0.05
    );

    const metrics = registry.getSingleMetric("http_request_duration_seconds");
    expect(metrics).toBeDefined();
  });

  describe("metric registration (#602)", () => {
    it("registers every exported metric on the shared registry", () => {
      const registeredNames = registry.getMetricsAsArray().map((m) => m.name);
      expect(registeredNames).toEqual(
        expect.arrayContaining([
          "http_requests_total",
          "http_request_duration_seconds",
          "stellar_tx_duration_seconds",
          "quiz_submissions_total",
          "reward_claims_total",
          "credentials_minted_total",
          "dependency_health_check_seconds",
        ]),
      );
    });

    it("registers stellarTxDurationSeconds as a histogram with method and status labels", () => {
      expect(metricName(stellarTxDurationSeconds)).toBe("stellar_tx_duration_seconds");
      stellarTxDurationSeconds.observe({ method: "invoke", status: "success" }, 1.2);
      const json = (stellarTxDurationSeconds as unknown as { labelNames: string[] }).labelNames;
      expect(json).toEqual(["method", "status"]);
    });

    it("registers quizSubmissionsTotal as a counter with a result label", () => {
      expect(metricName(quizSubmissionsTotal)).toBe("quiz_submissions_total");
      quizSubmissionsTotal.inc({ result: "pass" });
    });

    it("registers rewardClaimsTotal as a counter with a status label", () => {
      expect(metricName(rewardClaimsTotal)).toBe("reward_claims_total");
      rewardClaimsTotal.inc({ status: "claimed" });
    });

    it("registers credentialsMintedTotal as an unlabeled counter", () => {
      expect(metricName(credentialsMintedTotal)).toBe("credentials_minted_total");
      credentialsMintedTotal.inc();
    });

    it("registers dependencyHealthCheckSeconds as a histogram with service and status labels", () => {
      expect(metricName(dependencyHealthCheckSeconds)).toBe("dependency_health_check_seconds");
      dependencyHealthCheckSeconds.observe({ service: "redis", status: "ok" }, 0.01);
    });
  });

  describe("metric collection and label handling (#602)", () => {
    it("accumulates multiple increments for the same label combination", async () => {
      httpRequestsTotal.inc({ method: "GET", route: "/courses", status_code: "200" });
      httpRequestsTotal.inc({ method: "GET", route: "/courses", status_code: "200" });
      httpRequestsTotal.inc({ method: "GET", route: "/courses", status_code: "200" });

      const metric = await metricJson("http_requests_total");
      const entry = metric?.values.find(
        (v) =>
          v.labels.method === "GET" &&
          v.labels.route === "/courses" &&
          v.labels.status_code === "200",
      );
      expect(entry?.value).toBe(3);
    });

    it("tracks distinct label combinations as separate time series", async () => {
      httpRequestsTotal.inc({ method: "GET", route: "/courses", status_code: "200" });
      httpRequestsTotal.inc({ method: "POST", route: "/courses", status_code: "201" });
      httpRequestsTotal.inc({ method: "GET", route: "/courses", status_code: "500" });

      const metric = await metricJson("http_requests_total");
      expect(metric?.values).toHaveLength(3);
    });

    it("records histogram observations into the correct bucket", async () => {
      httpRequestDurationSeconds.observe({ method: "GET", route: "/fast", status_code: "200" }, 0.003);
      httpRequestDurationSeconds.observe({ method: "GET", route: "/slow", status_code: "200" }, 4.5);

      const metric = await metricJson("http_request_duration_seconds");
      const bucketValues = metric?.values.filter((v) => "le" in v.labels) ?? [];
      // The 0.005s bucket should have counted the fast request but not the slow one.
      const smallestBucket = bucketValues.find(
        (v) => v.labels.le === 0.005 && v.labels.route === "/fast",
      );
      const slowInSmallestBucket = bucketValues.find(
        (v) => v.labels.le === 0.005 && v.labels.route === "/slow",
      );
      expect(smallestBucket?.value).toBe(1);
      expect(slowInSmallestBucket?.value).toBe(0);
    });

    it("exposes metrics in Prometheus exposition format via registry.metrics()", async () => {
      httpRequestsTotal.inc({ method: "GET", route: "/health", status_code: "200" });
      const output = await registry.metrics();
      expect(output).toContain("http_requests_total");
      expect(output).toMatch(/http_requests_total\{[^}]*method="GET"[^}]*}\s+1/);
    });

    it("resetMetrics clears accumulated counter values", async () => {
      httpRequestsTotal.inc({ method: "GET", route: "/x", status_code: "200" });
      registry.resetMetrics();
      const metric = await metricJson("http_requests_total");
      expect(metric?.values).toHaveLength(0);
    });
  });

  describe("setupInfraMetrics (#602)", () => {
    function fakePool(totalCount: number, idleCount: number) {
      return { totalCount, idleCount } as unknown as import("pg").Pool;
    }

    function fakeRedis() {
      return new EventEmitter() as unknown as import("ioredis").Redis;
    }

    // setupInfraMetrics registers its Gauges on the shared registry on
    // every call; registry.resetMetrics() clears VALUES but not
    // registrations, so calling it twice without unregistering first
    // throws "already been registered". Each test gets a clean slate.
    afterEach(() => {
      registry.removeSingleMetric("db_active_connections");
      registry.removeSingleMetric("redis_connected");
    });

    it("registers db_active_connections as totalCount minus idleCount", async () => {
      const pool = fakePool(10, 3);
      setupInfraMetrics(pool, fakeRedis());

      const metric = await metricJson("db_active_connections");
      expect(metric?.values[0]?.value).toBe(7);
    });

    it("registers redis_connected starting at 0 (disconnected)", async () => {
      setupInfraMetrics(fakePool(1, 0), fakeRedis());
      const metric = await metricJson("redis_connected");
      expect(metric?.values[0]?.value).toBe(0);
    });

    it("sets redis_connected to 1 after a connect event", async () => {
      const redis = fakeRedis();
      setupInfraMetrics(fakePool(1, 0), redis);

      redis.emit("connect");

      const metric = await metricJson("redis_connected");
      expect(metric?.values[0]?.value).toBe(1);
    });

    it("sets redis_connected back to 0 after a close event", async () => {
      const redis = fakeRedis();
      setupInfraMetrics(fakePool(1, 0), redis);

      redis.emit("connect");
      redis.emit("close");

      const metric = await metricJson("redis_connected");
      expect(metric?.values[0]?.value).toBe(0);
    });

    it("sets redis_connected to 0 after an error event", async () => {
      const redis = fakeRedis();
      setupInfraMetrics(fakePool(1, 0), redis);

      redis.emit("connect");
      redis.emit("error", new Error("connection lost"));

      const metric = await metricJson("redis_connected");
      expect(metric?.values[0]?.value).toBe(0);
    });

    it("re-derives db_active_connections on every collection, reflecting live pool state", async () => {
      const pool = { totalCount: 5, idleCount: 5 } as unknown as import("pg").Pool;
      setupInfraMetrics(pool, fakeRedis());

      let metric = await metricJson("db_active_connections");
      expect(metric?.values[0]?.value).toBe(0);

      pool.idleCount = 2;
      metric = await metricJson("db_active_connections");
      expect(metric?.values[0]?.value).toBe(3);
    });
  });
});
