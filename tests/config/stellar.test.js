"use strict";

/**
 * Tests for src/config/stellar.js — network configuration (Issue #864).
 *
 * Verifies:
 *  - Testnet default Horizon URL
 *  - Mainnet default Horizon URL
 *  - HORIZON_URL environment override
 *  - SOROBAN_RPC_URL configuration (default and override)
 *
 * Because stellar.js is loaded once per process and caches its values via
 * require(), each test that needs a different env must isolate the module
 * registry with jest.resetModules() and re-require the module inside the test.
 */

describe("src/config/stellar.js — network configuration", () => {
  // Snapshot of the original env so we can restore it after every test
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    // Restore all env vars before each test so they don't bleed across
    Object.keys(process.env).forEach((key) => {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    });
    Object.assign(process.env, ORIGINAL_ENV);
  });

  afterEach(() => {
    jest.resetModules();
    // Full env restore after each test
    Object.keys(process.env).forEach((key) => {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    });
    Object.assign(process.env, ORIGINAL_ENV);
  });

  // ── Horizon URL ──────────────────────────────────────────────────────────

  describe("Horizon URL — testnet", () => {
    it("uses the SDF testnet Horizon URL when STELLAR_NETWORK=testnet", () => {
      process.env.STELLAR_NETWORK = "testnet";
      delete process.env.HORIZON_URL;

      const { horizonUrl } = require("../../src/config/stellar");

      expect(horizonUrl).toBe("https://horizon-testnet.stellar.org");
    });

    it("defaults to testnet when STELLAR_NETWORK is not set", () => {
      delete process.env.STELLAR_NETWORK;
      delete process.env.HORIZON_URL;

      const { horizonUrl } = require("../../src/config/stellar");

      expect(horizonUrl).toBe("https://horizon-testnet.stellar.org");
    });
  });

  describe("Horizon URL — mainnet", () => {
    it("uses the SDF mainnet Horizon URL when STELLAR_NETWORK=mainnet", () => {
      process.env.STELLAR_NETWORK = "mainnet";
      delete process.env.HORIZON_URL;

      const { horizonUrl } = require("../../src/config/stellar");

      expect(horizonUrl).toBe("https://horizon.stellar.org");
    });
  });

  describe("Horizon URL — HORIZON_URL override", () => {
    it("uses the custom URL from HORIZON_URL when set", () => {
      process.env.HORIZON_URL = "https://my-custom-horizon.example.com";
      process.env.STELLAR_NETWORK = "testnet";

      const { horizonUrl } = require("../../src/config/stellar");

      expect(horizonUrl).toBe("https://my-custom-horizon.example.com");
    });

    it("HORIZON_URL override takes precedence over STELLAR_NETWORK=mainnet", () => {
      process.env.STELLAR_NETWORK = "mainnet";
      process.env.HORIZON_URL = "https://private-horizon.example.com";

      const { horizonUrl } = require("../../src/config/stellar");

      expect(horizonUrl).toBe("https://private-horizon.example.com");
    });
  });

  // ── NETWORK value ────────────────────────────────────────────────────────

  describe("NETWORK export", () => {
    it("exports NETWORK as 'testnet' when STELLAR_NETWORK=testnet", () => {
      process.env.STELLAR_NETWORK = "testnet";
      const { NETWORK } = require("../../src/config/stellar");
      expect(NETWORK).toBe("testnet");
    });

    it("exports NETWORK as 'mainnet' when STELLAR_NETWORK=mainnet", () => {
      process.env.STELLAR_NETWORK = "mainnet";
      const { NETWORK } = require("../../src/config/stellar");
      expect(NETWORK).toBe("mainnet");
    });

    it("defaults NETWORK to 'testnet' when STELLAR_NETWORK is not set", () => {
      delete process.env.STELLAR_NETWORK;
      const { NETWORK } = require("../../src/config/stellar");
      expect(NETWORK).toBe("testnet");
    });
  });

  // ── NETWORKS map ─────────────────────────────────────────────────────────

  describe("NETWORKS export", () => {
    it("exports a NETWORKS map containing testnet and mainnet URLs", () => {
      const { NETWORKS } = require("../../src/config/stellar");

      expect(NETWORKS).toMatchObject({
        testnet: "https://horizon-testnet.stellar.org",
        mainnet: "https://horizon.stellar.org",
      });
    });
  });

  // ── Soroban RPC URL ───────────────────────────────────────────────────────

  describe("Soroban RPC URL — testnet default", () => {
    it("uses the SDF testnet Soroban RPC URL by default on testnet", () => {
      process.env.STELLAR_NETWORK = "testnet";
      delete process.env.SOROBAN_RPC_URL;

      const { sorobanRpcUrl } = require("../../src/config/stellar");

      expect(sorobanRpcUrl).toBe("https://soroban-testnet.stellar.org");
    });
  });

  describe("Soroban RPC URL — SOROBAN_RPC_URL override", () => {
    it("uses the value from SOROBAN_RPC_URL when set", () => {
      process.env.STELLAR_NETWORK = "testnet";
      process.env.SOROBAN_RPC_URL = "https://my-soroban-rpc.example.com";

      const { sorobanRpcUrl } = require("../../src/config/stellar");

      expect(sorobanRpcUrl).toBe("https://my-soroban-rpc.example.com");
    });

    it("SOROBAN_RPC_URL override takes precedence over network default", () => {
      process.env.STELLAR_NETWORK = "testnet";
      process.env.SOROBAN_RPC_URL = "https://custom-rpc.example.com";

      const { sorobanRpcUrl } = require("../../src/config/stellar");

      expect(sorobanRpcUrl).toBe("https://custom-rpc.example.com");
    });
  });

  describe("Soroban RPC URL — mainnet (no default)", () => {
    it("is undefined on mainnet when SOROBAN_RPC_URL is not set", () => {
      process.env.STELLAR_NETWORK = "mainnet";
      delete process.env.SOROBAN_RPC_URL;

      const { sorobanRpcUrl } = require("../../src/config/stellar");

      // No SDF-hosted mainnet Soroban endpoint exists — must be explicitly configured
      expect(sorobanRpcUrl).toBeUndefined();
    });

    it("sorobanServer is null on mainnet when SOROBAN_RPC_URL is not set", () => {
      process.env.STELLAR_NETWORK = "mainnet";
      delete process.env.SOROBAN_RPC_URL;

      const { sorobanServer } = require("../../src/config/stellar");

      expect(sorobanServer).toBeNull();
    });
  });

  // ── server object ─────────────────────────────────────────────────────────

  describe("Horizon server instance", () => {
    it("exports a server object", () => {
      const { server } = require("../../src/config/stellar");
      expect(server).toBeDefined();
      expect(typeof server).toBe("object");
    });

    it("server has a serverInfo method (polyfill or native)", () => {
      const { server } = require("../../src/config/stellar");
      expect(typeof server.serverInfo).toBe("function");
    });
  });
});
