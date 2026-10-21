import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/config/stellar.js", () => ({
  getPlatformKeypair: vi.fn(() => mockKeypair),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockKeypair = {
  sign: vi.fn((data) => Buffer.from("mock-signature")),
};

import { createQuizProof, createMintAuthorization } from "../../../src/stellar/signatures.js";

describe("Stellar Signatures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createQuizProof", () => {
    it("should create a valid quiz proof", () => {
      const proof = createQuizProof("GUSER123", "quiz-1", 85);

      expect(proof).toHaveProperty("hash");
      expect(proof).toHaveProperty("signature");
      expect(typeof proof.hash).toBe("string");
      expect(typeof proof.signature).toBe("string");
      expect(mockKeypair.sign).toHaveBeenCalled();
    });

    it("should create different proofs for different inputs", () => {
      const proof1 = createQuizProof("GUSER123", "quiz-1", 85);
      const proof2 = createQuizProof("GUSER456", "quiz-1", 85);

      expect(proof1.hash).not.toBe(proof2.hash);
    });

    it("should include a nonce and timestamp, and generate a fresh nonce on every call", () => {
      const proof1 = createQuizProof("GUSER123", "quiz-1", 85);
      const proof2 = createQuizProof("GUSER123", "quiz-1", 85);

      expect(typeof proof1.nonce).toBe("string");
      expect(proof1.nonce.length).toBeGreaterThan(0);
      expect(proof1.nonce).not.toBe(proof2.nonce);
      // Nonce uniqueness is what makes two calls with identical business
      // inputs produce different hashes/signatures (single-use proofs).
      expect(proof1.hash).not.toBe(proof2.hash);

      expect(typeof proof1.timestamp).toBe("string");
      expect(() => new Date(proof1.timestamp)).not.toThrow();
      expect(new Date(proof1.timestamp).toISOString()).toBe(proof1.timestamp);
    });

    it("should produce a 64-character hex SHA-256 hash", () => {
      const proof = createQuizProof("GUSER123", "quiz-1", 85);
      expect(proof.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should produce a different hash when only the score differs", () => {
      const proof1 = createQuizProof("GUSER123", "quiz-1", 85);
      const proof2 = createQuizProof("GUSER123", "quiz-1", 90);
      expect(proof1.hash).not.toBe(proof2.hash);
    });
  });

  describe("createMintAuthorization", () => {
    it("should create a valid mint authorization", () => {
      const auth = createMintAuthorization("GUSER123", "course-1", 90);

      expect(auth).toHaveProperty("hash");
      expect(auth).toHaveProperty("signature");
      expect(typeof auth.hash).toBe("string");
      expect(typeof auth.signature).toBe("string");
      expect(mockKeypair.sign).toHaveBeenCalled();
    });

    it("should include a nonce and timestamp, and generate a fresh nonce on every call", () => {
      const auth1 = createMintAuthorization("GUSER123", "course-1", 90);
      const auth2 = createMintAuthorization("GUSER123", "course-1", 90);

      expect(typeof auth1.nonce).toBe("string");
      expect(auth1.nonce.length).toBeGreaterThan(0);
      expect(auth1.nonce).not.toBe(auth2.nonce);
      expect(auth1.hash).not.toBe(auth2.hash);

      expect(typeof auth1.timestamp).toBe("string");
      expect(new Date(auth1.timestamp).toISOString()).toBe(auth1.timestamp);
    });

    it("should produce a 64-character hex SHA-256 hash", () => {
      const auth = createMintAuthorization("GUSER123", "course-1", 90);
      expect(auth.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should produce a different hash than a quiz proof for the same user/score (different action discriminator)", () => {
      const quizProof = createQuizProof("GUSER123", "course-1", 90);
      const mintAuth = createMintAuthorization("GUSER123", "course-1", 90);
      expect(quizProof.hash).not.toBe(mintAuth.hash);
    });
  });
});
