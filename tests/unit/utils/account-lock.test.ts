import { describe, it, expect, vi } from "vitest";
import { withAccountLock } from "../../../src/utils/account-lock.js";

describe("withAccountLock (#589)", () => {
  it("acquires the lock and resolves with the wrapped function's result", async () => {
    const result = await withAccountLock("GABC123", async () => "done");
    expect(result).toBe("done");
  });

  it("releases the lock after the wrapped function resolves, allowing reuse", async () => {
    await withAccountLock("GABC123", async () => "first");
    const second = await withAccountLock("GABC123", async () => "second");
    expect(second).toBe("second");
  });

  it("releases the lock after the wrapped function throws, allowing reuse", async () => {
    await expect(
      withAccountLock("GABC123", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The lock must have been released even though fn() rejected.
    const result = await withAccountLock("GABC123", async () => "recovered");
    expect(result).toBe("recovered");
  });

  it("serializes concurrent calls for the same account", async () => {
    const order: string[] = [];

    const slow = withAccountLock("GSAME", async () => {
      order.push("slow-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("slow-end");
    });
    const fast = withAccountLock("GSAME", async () => {
      order.push("fast-start");
      order.push("fast-end");
    });

    await Promise.all([slow, fast]);

    // "fast" must not start until "slow" has fully released the lock.
    expect(order).toEqual(["slow-start", "slow-end", "fast-start", "fast-end"]);
  });

  it("runs concurrent calls for different accounts without serializing them", async () => {
    const order: string[] = [];

    const a = withAccountLock("GACC_A", async () => {
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("a-end");
    });
    const b = withAccountLock("GACC_B", async () => {
      order.push("b-start");
      order.push("b-end");
    });

    await Promise.all([a, b]);

    // Different accounts don't share a lock, so "b" finishes while "a" is
    // still pending rather than waiting for it to release.
    expect(order.indexOf("b-end")).toBeLessThan(order.indexOf("a-end"));
  });

  it("times out when the lock cannot be acquired within the configured window", async () => {
    vi.useFakeTimers();
    try {
      let releaseHeld: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        releaseHeld = resolve;
      });

      const holder = withAccountLock("GTIMEOUT", async () => held);
      const waiter = withAccountLock("GTIMEOUT", async () => "should not run");
      // Prevent Node from reporting this as an unhandled rejection before
      // the `expect(...).rejects` assertion below attaches its own handler.
      waiter.catch(() => {});

      await vi.advanceTimersByTimeAsync(10_001);

      await expect(waiter).rejects.toThrow();

      releaseHeld();
      await holder;
    } finally {
      vi.useRealTimers();
    }
  });
});
