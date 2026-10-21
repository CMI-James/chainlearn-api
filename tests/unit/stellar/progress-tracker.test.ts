import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConfig = vi.hoisted(() => ({
  config: { STELLAR_PROGRESS_TRACKER_CONTRACT_ID: "" as string | undefined },
}));

vi.mock("../../../src/config/index.js", () => ({ config: mockConfig.config }));

const mockSoroban = vi.hoisted(() => ({
  simulateTransaction: vi.fn(),
}));

vi.mock("../../../src/config/stellar.js", () => ({
  getSorobanServer: vi.fn(() => mockSoroban),
  getNetworkPassphrase: vi.fn(() => "Test SDF Network ; September 2015"),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    scValToNative: vi.fn(),
  };
});

import * as StellarSdk from "@stellar/stellar-sdk";
import { getOnChainContentHash } from "../../../src/stellar/progress-tracker.js";
import { logger } from "../../../src/utils/logger.js";

describe("getOnChainContentHash (#590)", () => {
  // A validly-formatted (though not necessarily deployed) Soroban contract
  // ID, since `new StellarSdk.Contract(...)` validates the strkey checksum.
  const VALID_CONTRACT_ID = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.config.STELLAR_PROGRESS_TRACKER_CONTRACT_ID = VALID_CONTRACT_ID;
  });

  it("returns null without calling Soroban when the contract isn't configured", async () => {
    mockConfig.config.STELLAR_PROGRESS_TRACKER_CONTRACT_ID = undefined;

    const result = await getOnChainContentHash("course-1");

    expect(result).toBeNull();
    expect(mockSoroban.simulateTransaction).not.toHaveBeenCalled();
  });

  it("retrieves and decodes the content hash on a successful simulation", async () => {
    const retval = "fake-scval";
    mockSoroban.simulateTransaction.mockResolvedValue({
      result: { retval },
    });
    vi.spyOn(StellarSdk.rpc.Api, "isSimulationError").mockReturnValue(false);
    vi.spyOn(StellarSdk.rpc.Api, "isSimulationSuccess").mockReturnValue(true);
    (StellarSdk.scValToNative as ReturnType<typeof vi.fn>).mockReturnValue("abc123hash");

    const result = await getOnChainContentHash("course-1");

    expect(result).toBe("abc123hash");
  });

  it("returns null when the decoded value is not a string", async () => {
    mockSoroban.simulateTransaction.mockResolvedValue({
      result: { retval: "fake-scval" },
    });
    vi.spyOn(StellarSdk.rpc.Api, "isSimulationError").mockReturnValue(false);
    vi.spyOn(StellarSdk.rpc.Api, "isSimulationSuccess").mockReturnValue(true);
    (StellarSdk.scValToNative as ReturnType<typeof vi.fn>).mockReturnValue(12345);

    const result = await getOnChainContentHash("course-1");

    expect(result).toBeNull();
  });

  it("returns null and warns when the simulation reports an error", async () => {
    mockSoroban.simulateTransaction.mockResolvedValue({ error: "contract trapped" });
    vi.spyOn(StellarSdk.rpc.Api, "isSimulationError").mockReturnValue(true);

    const result = await getOnChainContentHash("course-1");

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "course-1" }),
      expect.stringContaining("skipping content hash verification"),
    );
  });

  it("returns null when the simulation result has no retval", async () => {
    mockSoroban.simulateTransaction.mockResolvedValue({ result: {} });
    vi.spyOn(StellarSdk.rpc.Api, "isSimulationError").mockReturnValue(false);
    vi.spyOn(StellarSdk.rpc.Api, "isSimulationSuccess").mockReturnValue(true);

    const result = await getOnChainContentHash("course-1");

    expect(result).toBeNull();
  });

  it("returns null and warns when the RPC call throws", async () => {
    mockSoroban.simulateTransaction.mockRejectedValue(new Error("network unreachable"));

    const result = await getOnChainContentHash("course-1");

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "course-1" }),
      expect.stringContaining("Failed to read on-chain content hash"),
    );
  });
});
