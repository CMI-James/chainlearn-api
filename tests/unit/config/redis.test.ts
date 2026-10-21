import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * #607: config/redis.ts constructs a single ioredis client from
 * config.REDIS_URL at import time (same memoize-on-import pattern as
 * config/index.ts), so each case resets the module registry and re-imports
 * with a fresh env/mock rather than relying on the already-imported client.
 */

const mockRedisInstance = {
  on: vi.fn(),
  quit: vi.fn().mockResolvedValue("OK"),
};

const RedisConstructorMock = vi.fn(() => mockRedisInstance);

vi.mock("ioredis", () => ({
  default: RedisConstructorMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

async function loadRedisConfig(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  RedisConstructorMock.mockClear();
  mockRedisInstance.on.mockClear();
  mockRedisInstance.quit.mockClear();

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      vi.stubEnv(key, "");
      delete process.env[key];
    } else {
      vi.stubEnv(key, value);
    }
  }

  return import("../../../src/config/redis.js");
}

describe("config/redis.ts (#607)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("client creation", () => {
    it("constructs a single ioredis client from config.REDIS_URL", async () => {
      await loadRedisConfig({ REDIS_URL: "redis://custom-host:6380" });

      expect(RedisConstructorMock).toHaveBeenCalledOnce();
      expect(RedisConstructorMock).toHaveBeenCalledWith(
        "redis://custom-host:6380",
        expect.objectContaining({ maxRetriesPerRequest: 3 })
      );
    });

    it("falls back to the default redis://localhost:6379 when REDIS_URL is unset", async () => {
      await loadRedisConfig({ REDIS_URL: undefined });

      expect(RedisConstructorMock).toHaveBeenCalledWith(
        "redis://localhost:6379",
        expect.anything()
      );
    });

    it("exports the constructed client as `redis`", async () => {
      const { redis } = await loadRedisConfig();

      expect(redis).toBe(mockRedisInstance);
    });

    it("registers error and connect event handlers on the client", async () => {
      await loadRedisConfig();

      const registeredEvents = mockRedisInstance.on.mock.calls.map((call) => call[0]);
      expect(registeredEvents).toContain("error");
      expect(registeredEvents).toContain("connect");
    });
  });

  describe("retryStrategy", () => {
    it("backs off linearly, capped at 2000ms", async () => {
      await loadRedisConfig();

      const options = RedisConstructorMock.mock.calls[0]![1] as {
        retryStrategy: (times: number) => number | null;
      };

      expect(options.retryStrategy(1)).toBe(200);
      expect(options.retryStrategy(5)).toBe(1000);
      // 8 * 200 = 1600
      expect(options.retryStrategy(8)).toBe(1600);
      // 10 * 200 = 2000, exactly at the cap
      expect(options.retryStrategy(10)).toBe(2000);
    });

    it("gives up (returns null) after more than 10 attempts", async () => {
      await loadRedisConfig();

      const options = RedisConstructorMock.mock.calls[0]![1] as {
        retryStrategy: (times: number) => number | null;
      };

      expect(options.retryStrategy(10)).not.toBeNull();
      expect(options.retryStrategy(11)).toBeNull();
    });
  });

  describe("closeRedis()", () => {
    it("quits the underlying client", async () => {
      const { closeRedis } = await loadRedisConfig();

      await closeRedis();

      expect(mockRedisInstance.quit).toHaveBeenCalledOnce();
    });

    it("propagates an error from quit()", async () => {
      const { closeRedis } = await loadRedisConfig();
      mockRedisInstance.quit.mockRejectedValueOnce(new Error("quit failed"));

      await expect(closeRedis()).rejects.toThrow("quit failed");
    });
  });
});
