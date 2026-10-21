import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRedis = vi.hoisted(() => ({
  eval: vi.fn(),
  del: vi.fn(),
  set: vi.fn(),
}));

vi.mock("../../../src/config/redis.js", () => ({ redis: mockRedis }));

const mockStellarClient = vi.hoisted(() => ({
  getAccount: vi.fn(),
}));

vi.mock("../../../src/stellar/client.js", () => ({
  stellarClient: mockStellarClient,
}));

vi.mock("../../../src/audit/index.js", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

import { sequenceCache } from "../../../src/stellar/sequence-cache.js";
import { auditLog } from "../../../src/audit/index.js";

describe("SequenceCache (#588)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getNextSequence", () => {
    it("returns the incremented sequence on a cache hit", async () => {
      mockRedis.eval.mockResolvedValueOnce(43);

      const result = await sequenceCache.getNextSequence("GABC123");

      expect(result).toBe("43");
      expect(mockStellarClient.getAccount).not.toHaveBeenCalled();
    });

    it("falls back to Horizon and seeds the cache on a cache miss (key absent)", async () => {
      mockRedis.eval.mockResolvedValueOnce(false);
      mockStellarClient.getAccount.mockResolvedValue({ sequence: "100" });
      mockRedis.eval.mockResolvedValueOnce("100");

      const result = await sequenceCache.getNextSequence("GABC123");

      expect(mockStellarClient.getAccount).toHaveBeenCalledWith("GABC123");
      expect(result).toBe("100");
      // Second eval call seeds with the account's *current* sequence, not +1.
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        1,
        expect.stringContaining("GABC123"),
        300,
        "100",
      );
    });

    it("falls back to Horizon on a cache miss represented by null", async () => {
      mockRedis.eval.mockResolvedValueOnce(null);
      mockStellarClient.getAccount.mockResolvedValue({ sequence: "7" });
      mockRedis.eval.mockResolvedValueOnce("7");

      const result = await sequenceCache.getNextSequence("GXYZ");

      expect(mockStellarClient.getAccount).toHaveBeenCalledWith("GXYZ");
      expect(result).toBe("7");
    });

    it("handles another process seeding the cache first (NX collision)", async () => {
      mockRedis.eval.mockResolvedValueOnce(false);
      mockStellarClient.getAccount.mockResolvedValue({ sequence: "50" });
      // SEED_AND_INCREMENT_SCRIPT returns the incremented value when the
      // SET NX loses the race to another process.
      mockRedis.eval.mockResolvedValueOnce(51);

      const result = await sequenceCache.getNextSequence("GRACE");

      expect(result).toBe("51");
    });

    it("supports concurrent calls for different accounts independently", async () => {
      mockRedis.eval.mockImplementation(async (_script, _n, key) => {
        return key.includes("GONE") ? 11 : 22;
      });

      const [one, two] = await Promise.all([
        sequenceCache.getNextSequence("GONE"),
        sequenceCache.getNextSequence("GTWO"),
      ]);

      expect(one).toBe("11");
      expect(two).toBe("22");
    });
  });

  describe("invalidate", () => {
    it("deletes the cache key for the account", async () => {
      await sequenceCache.invalidate("GABC123");

      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining("GABC123"));
    });

    it("writes an audit log entry on invalidation", async () => {
      await sequenceCache.invalidate("GABC123");

      expect(auditLog).toHaveBeenCalledWith(
        "cache.invalidated",
        expect.objectContaining({ url: expect.stringContaining("GABC123") }),
      );
    });

    it("does not throw when the audit log call rejects", async () => {
      (auditLog as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        Promise.reject(new Error("audit down")),
      );

      await expect(sequenceCache.invalidate("GABC123")).resolves.toBeUndefined();
    });
  });

  describe("resetTo", () => {
    it("sets the cache key to the given sequence with the configured TTL", async () => {
      await sequenceCache.resetTo("GABC123", 999n);

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining("GABC123"),
        "999",
        "EX",
        300,
      );
    });
  });
});
