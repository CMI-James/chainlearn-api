import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * #604: Stellar SDK configuration — network passphrase, server
 * construction, and platform keypair loading.
 *
 * src/config/stellar.ts reads the memoized `config` singleton from
 * src/config/index.ts, which itself reads process.env once at import time.
 * Each case resets the module registry and re-imports both modules with a
 * fresh env, following the same pattern as tests/unit/config/cors-origins.test.ts.
 */
async function loadStellarConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      vi.stubEnv(key, "");
      delete process.env[key];
    } else {
      vi.stubEnv(key, value);
    }
  }
  return import("../../../src/config/stellar.js");
}

// A valid Stellar secret key (not tied to any funded account; used only to
// exercise Keypair.fromSecret's checksum validation in tests).
const VALID_SECRET = "SABFGDEMCBXDUQKC575F2W5QSJ2CLYUPQVCQC4GNSONWXRTWE4ZM3S7Q";

describe("Stellar config (#604)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("getNetworkPassphrase", () => {
    it("returns the testnet passphrase when STELLAR_NETWORK is testnet", async () => {
      const { getNetworkPassphrase } = await loadStellarConfig({
        NODE_ENV: "test",
        STELLAR_NETWORK: "testnet",
      });

      expect(getNetworkPassphrase()).toBe(StellarSdk.Networks.TESTNET);
    });

    it("returns the public/mainnet passphrase when STELLAR_NETWORK is mainnet", async () => {
      const { getNetworkPassphrase } = await loadStellarConfig({
        NODE_ENV: "test",
        STELLAR_NETWORK: "mainnet",
      });

      expect(getNetworkPassphrase()).toBe(StellarSdk.Networks.PUBLIC);
    });

    it("defaults to the testnet passphrase when STELLAR_NETWORK is unset", async () => {
      const { getNetworkPassphrase } = await loadStellarConfig({
        NODE_ENV: "test",
        STELLAR_NETWORK: undefined,
      });

      expect(getNetworkPassphrase()).toBe(StellarSdk.Networks.TESTNET);
    });
  });

  describe("getHorizonServer", () => {
    it("constructs a Horizon server pointed at the configured URL", async () => {
      const { getHorizonServer } = await loadStellarConfig({
        NODE_ENV: "test",
        STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
      });

      const server = getHorizonServer();
      expect(server).toBeInstanceOf(StellarSdk.Horizon.Server);
      expect(server.serverURL.toString()).toBe("https://horizon-testnet.stellar.org/");
    });

    it("returns a new Horizon server instance on each call", async () => {
      const { getHorizonServer } = await loadStellarConfig({
        NODE_ENV: "test",
        STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
      });

      expect(getHorizonServer()).not.toBe(getHorizonServer());
    });
  });

  describe("getSorobanServer", () => {
    it("constructs a Soroban RPC server pointed at the configured URL", async () => {
      const { getSorobanServer } = await loadStellarConfig({
        NODE_ENV: "test",
        STELLAR_SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
      });

      const server = getSorobanServer();
      expect(server).toBeInstanceOf(StellarSdk.rpc.Server);
    });

    it("returns a new Soroban server instance on each call", async () => {
      const { getSorobanServer } = await loadStellarConfig({
        NODE_ENV: "test",
        STELLAR_SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
      });

      expect(getSorobanServer()).not.toBe(getSorobanServer());
    });
  });

  describe("getPlatformKeypair", () => {
    it("loads a Keypair from STELLAR_PLATFORM_SECRET", async () => {
      const { getPlatformKeypair } = await loadStellarConfig({
        NODE_ENV: "test",
        STELLAR_PLATFORM_SECRET: VALID_SECRET,
      });

      const keypair = getPlatformKeypair();
      expect(keypair).toBeInstanceOf(StellarSdk.Keypair);
      expect(keypair.secret()).toBe(VALID_SECRET);
    });

    it("caches the keypair as a singleton across calls", async () => {
      const { getPlatformKeypair } = await loadStellarConfig({
        NODE_ENV: "test",
        STELLAR_PLATFORM_SECRET: VALID_SECRET,
      });

      const first = getPlatformKeypair();
      const second = getPlatformKeypair();
      expect(first).toBe(second);
    });

    it("derives the expected public key from the secret", async () => {
      const { getPlatformKeypair } = await loadStellarConfig({
        NODE_ENV: "test",
        STELLAR_PLATFORM_SECRET: VALID_SECRET,
      });

      const expected = StellarSdk.Keypair.fromSecret(VALID_SECRET).publicKey();
      expect(getPlatformKeypair().publicKey()).toBe(expected);
    });
  });
});
