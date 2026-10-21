import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * #601: logger.ts builds its pino instance once at import time from
 * process.env.NODE_ENV, so each level/transport case resets the module
 * registry and re-imports it with a fresh env, same pattern as
 * tests/unit/config/cors-origins.test.ts.
 *
 * Also re-imports request-context.js in the SAME reset cycle: after
 * vi.resetModules(), logger.js's own import of request-context.js resolves
 * to a fresh module instance with its own AsyncLocalStorage. A
 * runWithRequestContext imported once at this file's top (before any
 * reset) would be bound to a DIFFERENT instance and never share state with
 * the logger's mixin, so each test that needs request-context must get it
 * from this same loadLogger() call.
 */
async function loadLogger(nodeEnv: string | undefined) {
  vi.resetModules();
  if (nodeEnv === undefined) {
    vi.stubEnv("NODE_ENV", "");
    delete process.env.NODE_ENV;
  } else {
    vi.stubEnv("NODE_ENV", nodeEnv);
  }
  const loggerModule = await import("../../../src/utils/logger.js");
  const { runWithRequestContext } = await import("../../../src/utils/request-context.js");
  return { ...loggerModule, runWithRequestContext };
}

/**
 * pino stores its configured mixin/serializers under plain (non-registry)
 * Symbol("pino.mixin")/Symbol("pino.serializers") instances, so
 * Symbol.for("pino.mixin") — which looks up the GLOBAL symbol registry —
 * does not match pino's own symbol even though both stringify the same.
 * Reflection is the only way to reach the real one from outside the module.
 */
function getPinoInternal<T>(instance: object, description: string): T {
  const symbol = Object.getOwnPropertySymbols(instance).find(
    (s) => s.toString() === `Symbol(${description})`,
  );
  if (!symbol) throw new Error(`pino instance has no ${description} symbol`);
  return (instance as Record<symbol, unknown>)[symbol] as T;
}

describe("logger configuration (#601)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses level 'info' in production", async () => {
    const { logger } = await loadLogger("production");
    expect(logger.level).toBe("info");
  });

  it("uses level 'silent' in test", async () => {
    const { logger } = await loadLogger("test");
    expect(logger.level).toBe("silent");
  });

  it("uses level 'debug' in development", async () => {
    const { logger } = await loadLogger("development");
    expect(logger.level).toBe("debug");
  });

  it("defaults to 'debug' (development behavior) when NODE_ENV is unset", async () => {
    const { logger } = await loadLogger(undefined);
    expect(logger.level).toBe("debug");
  });

  it("serializes a request to only method and url, dropping sensitive headers", async () => {
    const { logger } = await loadLogger("test");
    const fakeRequest = { method: "GET", url: "/api/v1/courses", headers: { authorization: "Bearer secret" } };
    const serializers = getPinoInternal<{ req: (r: typeof fakeRequest) => unknown }>(logger, "pino.serializers");
    const serialized = serializers.req(fakeRequest);
    expect(serialized).toEqual({ method: "GET", url: "/api/v1/courses" });
    expect(serialized).not.toHaveProperty("headers");
  });

  it("serializes a reply to only statusCode", async () => {
    const { logger } = await loadLogger("test");
    const fakeReply = { statusCode: 201, body: { secret: "data" } };
    const serializers = getPinoInternal<{ res: (r: typeof fakeReply) => unknown }>(logger, "pino.serializers");
    const serialized = serializers.res(fakeReply);
    expect(serialized).toEqual({ statusCode: 201 });
    expect(serialized).not.toHaveProperty("body");
  });

  it("injects the current request's requestId via mixin when a request context is active", async () => {
    const { logger, runWithRequestContext } = await loadLogger("test");
    const mixin = getPinoInternal<() => Record<string, unknown>>(logger, "pino.mixin");

    let result: Record<string, unknown> = {};
    runWithRequestContext("req-abc-123", () => {
      result = mixin();
    });
    expect(result).toEqual({ requestId: "req-abc-123" });
  });

  it("returns an empty mixin object when no request context is active", async () => {
    const { logger } = await loadLogger("test");
    const mixin = getPinoInternal<() => Record<string, unknown>>(logger, "pino.mixin");
    expect(mixin()).toEqual({});
  });

  it("lets an explicit requestId in the log call's own fields win over the mixin (pino merges mixin first, call fields on top)", async () => {
    const { logger, runWithRequestContext } = await loadLogger("test");
    const mixin = getPinoInternal<() => Record<string, unknown>>(logger, "pino.mixin");
    const chunks: string[] = [];
    const destination = { write: (chunk: string) => { chunks.push(chunk); return true; } };
    const pino = (await import("pino")).default;
    const testLogger = pino({ level: "info", mixin }, destination);

    runWithRequestContext("from-context", () => {
      testLogger.info({ requestId: "explicit-override" }, "overridden message");
    });

    expect(chunks.length).toBeGreaterThan(0);
    const parsed = JSON.parse(chunks[chunks.length - 1]!);
    expect(parsed.requestId).toBe("explicit-override");
  });
});
