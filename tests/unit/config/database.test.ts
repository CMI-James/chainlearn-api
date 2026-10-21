import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * #606: database configuration (src/config/database.ts) has no unit tests.
 *
 * The module constructs a real `pg.Pool` and `drizzle()` instance at import
 * time, so `pg` and `drizzle-orm/node-postgres` are mocked here the same way
 * tracing.test.ts mocks the OpenTelemetry SDK — nothing actually connects to
 * a database. `src/utils/logger.js` and `../database/schema.js` are mocked
 * too, so this stays a pure unit test of the pool/connection configuration,
 * not an integration test of drizzle or the schema.
 */

const poolInstances: Array<Record<string, unknown>> = [];

vi.mock("pg", () => {
  const Pool = vi
    .fn()
    .mockImplementation((options: Record<string, unknown>) => {
      const handlers: Record<string, (...args: unknown[]) => void> = {};
      const instance = {
        options,
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          handlers[event] = handler;
        }),
        end: vi.fn().mockResolvedValue(undefined),
        _emit: (event: string, ...args: unknown[]) =>
          handlers[event]?.(...args),
      };
      poolInstances.push(instance);
      return instance;
    });
  return { Pool };
});

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn((pool, opts) => ({ pool, opts })),
}));

vi.mock("../../../src/database/schema.js", () => ({}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

async function loadDatabase(databaseUrl: string) {
  vi.resetModules();
  poolInstances.length = 0;
  vi.stubEnv("DATABASE_URL", databaseUrl);
  // REQUIRED_IN_TEST_MODE (src/config/index.ts) checks process.env directly
  // for these before any fallback applies, so they must be set even though
  // this test never uses their values.
  vi.stubEnv(
    "JWT_SECRET",
    "test-secret-key-that-is-at-least-sixty-four-characters-long-for-tests",
  );
  vi.stubEnv("STELLAR_PLATFORM_SECRET", "S" + "A".repeat(55));
  const { Pool } = await import("pg");
  const dbModule = await import("../../../src/config/database.js");
  const { logger } = await import("../../../src/utils/logger.js");
  return {
    Pool,
    dbModule,
    logger,
    poolInstance: poolInstances[poolInstances.length - 1],
  };
}

describe("database config (#606)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("configures the pool with the DATABASE_URL from config", async () => {
    const { poolInstance } = await loadDatabase(
      "postgresql://user:pass@localhost:5432/chainlearn_test",
    );

    expect(poolInstance.options).toMatchObject({
      connectionString: "postgresql://user:pass@localhost:5432/chainlearn_test",
    });
  });

  it("sets a bounded pool size and timeouts so a misbehaving dependency can't exhaust connections or hang forever", async () => {
    const { poolInstance } = await loadDatabase(
      "postgresql://user:pass@localhost:5432/chainlearn_test",
    );

    expect(poolInstance.options).toMatchObject({
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  });

  it("registers an error handler on the pool that logs instead of crashing the process", async () => {
    const { poolInstance, logger } = await loadDatabase(
      "postgresql://user:pass@localhost:5432/chainlearn_test",
    );

    expect(poolInstance.on).toHaveBeenCalledWith("error", expect.any(Function));

    const err = new Error("connection terminated unexpectedly");
    (poolInstance as { _emit: (e: string, ...a: unknown[]) => void })._emit(
      "error",
      err,
    );

    expect(logger.error).toHaveBeenCalledWith(
      { err },
      "Unexpected PG pool error",
    );
  });

  it("wires drizzle to the configured pool", async () => {
    const { dbModule, poolInstance } = await loadDatabase(
      "postgresql://user:pass@localhost:5432/chainlearn_test",
    );

    expect(dbModule.db).toBeDefined();
    expect((dbModule.db as unknown as { pool: unknown }).pool).toBe(
      poolInstance,
    );
  });

  it("exports the pool itself alongside db", async () => {
    const { dbModule, poolInstance } = await loadDatabase(
      "postgresql://user:pass@localhost:5432/chainlearn_test",
    );

    expect(dbModule.pool).toBe(poolInstance);
  });

  it("closeDatabase() ends the pool", async () => {
    const { dbModule, poolInstance } = await loadDatabase(
      "postgresql://user:pass@localhost:5432/chainlearn_test",
    );

    await expect(dbModule.closeDatabase()).resolves.toBeUndefined();
    expect(poolInstance.end).toHaveBeenCalledTimes(1);
  });

  it("accepts a postgres:// connection string too, not only postgresql://", async () => {
    const { poolInstance } = await loadDatabase(
      "postgres://user:pass@localhost:5432/chainlearn_test",
    );

    expect(poolInstance.options).toMatchObject({
      connectionString: "postgres://user:pass@localhost:5432/chainlearn_test",
    });
  });
});
