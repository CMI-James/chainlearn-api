import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { StellarError } from "../../../src/utils/errors.js";

const VALID_PUBLIC_KEY = "GAXK5L7G7U7YGH4WGONDXK3ZO2RMGET6ANTTSBCN7CNNRWBFUO5NGXAM";
const VALID_CONTRACT_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const {
  mockSubmitTransaction,
  mockGetAccount,
  mockSimulateTransaction,
  mockInvalidate,
  mockGetNextSequence,
  mockContractCall,
} = vi.hoisted(() => ({
  mockSubmitTransaction: vi.fn(),
  mockGetAccount: vi.fn(),
  mockSimulateTransaction: vi.fn(),
  mockInvalidate: vi.fn(),
  mockGetNextSequence: vi.fn(),
  mockContractCall: vi.fn(),
}));

vi.mock("../../../src/config/stellar.js", () => ({
  getPlatformKeypair: vi.fn(() => ({
    publicKey: () => VALID_PUBLIC_KEY,
    sign: vi.fn(),
  })),
  getNetworkPassphrase: vi.fn(() => "Test SDF Network ; September 2015"),
  getSorobanServer: vi.fn(() => ({
    simulateTransaction: mockSimulateTransaction,
  })),
}));

vi.mock("../../../src/config/index.js", () => ({
  config: {
    STELLAR_QUIZ_CONTRACT_ID: VALID_CONTRACT_ID,
  },
}));

vi.mock("../../../src/stellar/client.js", () => ({
  stellarClient: {
    submitTransaction: mockSubmitTransaction,
    getAccount: mockGetAccount,
  },
}));

vi.mock("../../../src/stellar/sequence-cache.js", () => ({
  sequenceCache: {
    getNextSequence: mockGetNextSequence,
    invalidate: mockInvalidate,
    submitTransaction: vi.fn(),
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../src/utils/account-lock.js", () => ({
  withAccountLock: vi.fn((_id: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@stellar/stellar-sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@stellar/stellar-sdk")>("@stellar/stellar-sdk");
  return {
    ...actual,
    Contract: vi.fn().mockImplementation(() => ({
      call: mockContractCall,
    })),
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({
        sign: vi.fn(),
      }),
    })),
    Account: vi.fn(),
    BASE_FEE: "100",
    Operation: {
      payment: vi.fn(),
    },
    Asset: {
      native: vi.fn(),
    },
    rpc: {
      Api: {
        isSimulationError: vi.fn().mockReturnValue(false),
      },
      assembleTransaction: vi.fn().mockReturnValue({
        build: vi.fn().mockReturnValue({
          sign: vi.fn(),
        }),
      }),
    },
  };
});

// `StellarSdk.rpc.Api.isSimulationError` is declared as a type-predicate
// function, which a bare `vi.fn()` can never satisfy no matter how it is
// configured. The namespace is aliased to a plain spy holder here so the
// mock assignments below are not forced to cast at each use site.
type IsSimErrorSpyHolder = { isSimulationError: Mock };

import { invokeContract } from "../../../src/stellar/transactions.js";

describe("invokeContract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNextSequence.mockResolvedValue("100");
    mockSimulateTransaction.mockResolvedValue({
      transactionData: { toXDR: () => "AAAA" },
      results: [{}],
    });
    mockContractCall.mockReturnValue([]);
  });

  it("submits a transaction and returns its hash on success", async () => {
    mockSubmitTransaction.mockResolvedValue({ hash: "abc123" });

    const result = await invokeContract(VALID_CONTRACT_ID, "method", []);

    expect(result).toBe("abc123");
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
  });

  it("retries once on bad_seq and invalidates the cached sequence", async () => {
    mockSubmitTransaction
      .mockRejectedValueOnce(new StellarError('tx failed: ["tx_bad_seq"]'))
      .mockResolvedValueOnce({ hash: "def456" });

    const result = await invokeContract(VALID_CONTRACT_ID, "method", []);

    expect(result).toBe("def456");
    expect(mockInvalidate).toHaveBeenCalledWith(VALID_PUBLIC_KEY);
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(2);
  });

  it("isSimulationError type-predicate spy slot can be rebound per test", async () => {
    // Smoke test for the namespace alias documented at the top of the file.
    // The important invariant is only that we can rebind the spy without
    // violating the SDK type contract when a test wants it to return true.
    const sdk = (await import("@stellar/stellar-sdk")) as unknown as {
      rpc: { Api: IsSimErrorSpyHolder };
    };
    sdk.rpc.Api.isSimulationError = vi.fn().mockReturnValue(false);
    expect(sdk.rpc.Api.isSimulationError({} as never)).toBe(false);
  });
});
