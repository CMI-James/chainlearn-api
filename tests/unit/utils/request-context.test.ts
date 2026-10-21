import { describe, it, expect } from "vitest";
import {
  runWithRequestContext,
  getRequestId,
} from "../../../src/utils/request-context.js";

describe("request-context", () => {
  describe("runWithRequestContext / getRequestId", () => {
    it("propagates the requestId to code running inside the callback", () => {
      let seen: string | undefined;
      runWithRequestContext("req-abc", () => {
        seen = getRequestId();
      });
      expect(seen).toBe("req-abc");
    });

    it("returns undefined outside of any request context", () => {
      expect(getRequestId()).toBeUndefined();
    });

    it("propagates the requestId across an async operation inside the context", async () => {
      let seen: string | undefined;
      await new Promise<void>((resolve) => {
        runWithRequestContext("req-async", () => {
          setTimeout(() => {
            seen = getRequestId();
            resolve();
          }, 0);
        });
      });
      expect(seen).toBe("req-async");
    });

    it("propagates the requestId across a microtask (Promise.resolve) inside the context", async () => {
      let seen: string | undefined;
      await new Promise<void>((resolve) => {
        runWithRequestContext("req-microtask", () => {
          Promise.resolve().then(() => {
            seen = getRequestId();
            resolve();
          });
        });
      });
      expect(seen).toBe("req-microtask");
    });

    it("isolates requestId between sequential, non-nested contexts", () => {
      const seen: (string | undefined)[] = [];
      runWithRequestContext("req-1", () => {
        seen.push(getRequestId());
      });
      runWithRequestContext("req-2", () => {
        seen.push(getRequestId());
      });
      expect(seen).toEqual(["req-1", "req-2"]);
      expect(getRequestId()).toBeUndefined();
    });

    it("resolves to the innermost requestId within a nested context", () => {
      const seen: (string | undefined)[] = [];
      runWithRequestContext("outer", () => {
        seen.push(getRequestId());
        runWithRequestContext("inner", () => {
          seen.push(getRequestId());
        });
        // Back in the outer context after the nested call returns.
        seen.push(getRequestId());
      });
      expect(seen).toEqual(["outer", "inner", "outer"]);
    });

    it("isolates requestId between concurrently-running async contexts", async () => {
      const results: Record<string, string | undefined> = {};

      const runOne = (id: string, delayMs: number) =>
        new Promise<void>((resolve) => {
          runWithRequestContext(id, () => {
            setTimeout(() => {
              results[id] = getRequestId();
              resolve();
            }, delayMs);
          });
        });

      await Promise.all([runOne("req-x", 10), runOne("req-y", 5)]);

      expect(results["req-x"]).toBe("req-x");
      expect(results["req-y"]).toBe("req-y");
    });

    it("does not leak the requestId after the callback has returned", () => {
      runWithRequestContext("req-leak-check", () => {
        /* no-op */
      });
      expect(getRequestId()).toBeUndefined();
    });
  });
});
