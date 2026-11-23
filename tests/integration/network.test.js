/**
 * tests/integration/network.test.js
 *
 * Integration tests for /network/* endpoints against the real Stellar Testnet.
 *
 * These tests require:
 *   - STELLAR_NETWORK environment variable set to "testnet"
 *   - Live network access to horizon-testnet.stellar.org
 *
 * Tests are skipped automatically when STELLAR_NETWORK is not "testnet", so they are
 * safe to include in CI pipelines.
 *
 * Usage:
 *   STELLAR_NETWORK=testnet npx jest tests/integration/network.test.js
 */

"use strict";

const request = require("supertest");
const app = require("../../src/index");

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Skip an entire describe block when STELLAR_NETWORK is not "testnet". */
function describeIfTestnet(name, fn) {
  const network = process.env.STELLAR_NETWORK;
  if (network !== "testnet") {
    describe.skip(`${name} [skipped: STELLAR_NETWORK is not "testnet"]`, fn);
  } else {
    describe(name, fn);
  }
}

// Increase timeout — real Horizon calls can be slow on Testnet.
jest.setTimeout(30000);

// ── Tests ────────────────────────────────────────────────────────────────────

describeIfTestnet("Integration — Network endpoints (real Testnet)", () => {
  // ── 1. /network-status ──────────────────────────────────────────────────

  describe("GET /network-status", () => {
    it("returns 200 with normalised network status shape", async () => {
      const res = await request(app).get("/network-status");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      
      // Top-level shape
      expect(data).toHaveProperty("network", "testnet");
      expect(data).toHaveProperty("horizonUrl");
      expect(data).toHaveProperty("latestLedger");
      expect(data).toHaveProperty("fees");
      expect(data).toHaveProperty("protocol");

      // Latest ledger shape
      const { latestLedger } = data;
      expect(latestLedger).toHaveProperty("sequence");
      expect(typeof latestLedger.sequence).toBe("number");
      expect(latestLedger).toHaveProperty("closedAt");
      expect(latestLedger).toHaveProperty("transactionCount");
      expect(latestLedger).toHaveProperty("operationCount");
      expect(latestLedger).toHaveProperty("totalCoins");
      expect(latestLedger).toHaveProperty("feePool");

      // Fees shape
      const { fees } = data;
      expect(fees).toHaveProperty("baseFeeInStroops");
      expect(typeof fees.baseFeeInStroops).toBe("number");
      expect(fees).toHaveProperty("baseFeeInXLM");
      expect(typeof fees.baseFeeInXLM).toBe("string");
      expect(fees).toHaveProperty("basereserveInStroops");
      expect(fees).toHaveProperty("baseReserveInXLM");

      // Protocol shape
      expect(data.protocol).toHaveProperty("version");
      expect(typeof data.protocol.version).toBe("number");

      // Timestamp format validation
      expect(new Date(latestLedger.closedAt).toISOString()).toBe(latestLedger.closedAt);
    });

    it("sets X-Cache header", async () => {
      const res = await request(app).get("/network-status");
      expect(["HIT", "MISS"]).toContain(res.headers["x-cache"]);
    });

    it("?fresh=true forces a cache MISS", async () => {
      await request(app).get("/network-status");
      const res = await request(app).get("/network-status?fresh=true");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });
  });

  // ── 2. /network/base-fee ────────────────────────────────────────────────

  describe("GET /network/base-fee", () => {
    it("returns 200 with normalised base fee shape", async () => {
      const res = await request(app).get("/network/base-fee");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      
      // Required fields
      expect(data).toHaveProperty("baseFeeStroops");
      expect(typeof data.baseFeeStroops).toBe("number");
      expect(data).toHaveProperty("baseFeeXLM");
      expect(typeof data.baseFeeXLM).toBe("string");
      expect(data).toHaveProperty("isSurge");
      expect(typeof data.isSurge).toBe("boolean");
      expect(data).toHaveProperty("ledgerSequence");
      expect(data).toHaveProperty("ledgerClosedAt");
      expect(data).toHaveProperty("note");

      // Validate XLM format (7 decimals)
      expect(data.baseFeeXLM).toMatch(/^\d+\.\d{7}$/);
    });

    it("sets X-Cache header", async () => {
      const res = await request(app).get("/network/base-fee");
      expect(["HIT", "MISS"]).toContain(res.headers["x-cache"]);
    });

    it("?fresh=true forces a cache MISS", async () => {
      await request(app).get("/network/base-fee");
      const res = await request(app).get("/network/base-fee?fresh=true");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });
  });

  // ── 3. /network/validators ──────────────────────────────────────────────

  describe("GET /network/validators", () => {
    it("returns 200 with normalised validators shape", async () => {
      const res = await request(app).get("/network/validators");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      
      // Top-level shape
      expect(data).toHaveProperty("validators");
      expect(Array.isArray(data.validators)).toBe(true);
      expect(data).toHaveProperty("total");
      expect(typeof data.total).toBe("number");
      expect(data).toHaveProperty("byOrganisation");
      expect(typeof data.byOrganisation).toBe("object");
      expect(data).toHaveProperty("ungrouped");
      expect(Array.isArray(data.ungrouped)).toBe(true);

      // Each validator has the expected shape
      if (data.validators.length > 0) {
        const validator = data.validators[0];
        expect(validator).toHaveProperty("publicKey");
        expect(validator).toHaveProperty("homeDomain");
        expect(validator).toHaveProperty("isOrganization");
        expect(typeof validator.isOrganization).toBe("boolean");
        expect(validator).toHaveProperty("history");
        expect(validator.history).toHaveProperty("lastModifiedLedger");
        expect(validator.history).toHaveProperty("subentryCount");
        expect(validator).toHaveProperty("currentStatus");
        expect(["active", "restricted"]).toContain(validator.currentStatus);
      }
    });

    it("sets X-Cache header", async () => {
      const res = await request(app).get("/network/validators");
      expect(["HIT", "MISS"]).toContain(res.headers["x-cache"]);
    });

    it("?fresh=true forces a cache MISS", async () => {
      await request(app).get("/network/validators");
      const res = await request(app).get("/network/validators?fresh=true");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });
  });

  // ── 4. /ledger-timing ───────────────────────────────────────────────────

  describe("GET /ledger-timing", () => {
    it("returns 200 with normalised ledger timing shape", async () => {
      const res = await request(app).get("/ledger-timing");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      
      // Required fields
      expect(data).toHaveProperty("avgCloseTimeSeconds");
      expect(typeof data.avgCloseTimeSeconds).toBe("number");
      expect(data).toHaveProperty("minCloseTime");
      expect(typeof data.minCloseTime).toBe("number");
      expect(data).toHaveProperty("maxCloseTime");
      expect(typeof data.maxCloseTime).toBe("number");
      expect(data).toHaveProperty("stdDeviation");
      expect(typeof data.stdDeviation).toBe("number");
      expect(data).toHaveProperty("consistency");
      expect(["stable", "variable", "unstable"]).toContain(data.consistency);

      // Sanity checks on values
      expect(data.avgCloseTimeSeconds).toBeGreaterThan(0);
      expect(data.minCloseTime).toBeGreaterThanOrEqual(0);
      expect(data.maxCloseTime).toBeGreaterThanOrEqual(data.minCloseTime);
    });
  });

  // ── 5. /network/fee-percentiles ────────────────────────────────────────

  describe("GET /network/fee-percentiles", () => {
    it("returns 200 with normalised fee percentiles shape", async () => {
      const res = await request(app).get("/network/fee-percentiles");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      
      // Top-level shape
      expect(data).toHaveProperty("percentiles");
      expect(data).toHaveProperty("baseFee");
      expect(data).toHaveProperty("minFee");
      expect(data).toHaveProperty("maxFee");
      expect(data).toHaveProperty("ledgerSequence");
      expect(data).toHaveProperty("timestamp");

      // Percentiles shape (p10, p20, p30, p50, p70, p90, p95, p99)
      const { percentiles } = data;
      const percentileLevels = ["p10", "p20", "p30", "p50", "p70", "p90", "p95", "p99"];
      
      percentileLevels.forEach((level) => {
        expect(percentiles).toHaveProperty(level);
        expect(percentiles[level]).toHaveProperty("stroops");
        expect(typeof percentiles[level].stroops).toBe("number");
        expect(percentiles[level]).toHaveProperty("xlm");
        expect(typeof percentiles[level].xlm).toBe("string");
        expect(percentiles[level].xlm).toMatch(/^\d+\.\d{7}$/);
      });

      // Fee objects shape
      const feeObjects = [data.baseFee, data.minFee, data.maxFee];
      feeObjects.forEach((feeObj) => {
        expect(feeObj).toHaveProperty("stroops");
        expect(typeof feeObj.stroops).toBe("number");
        expect(feeObj).toHaveProperty("xlm");
        expect(typeof feeObj.xlm).toBe("string");
        expect(feeObj.xlm).toMatch(/^\d+\.\d{7}$/);
      });

      // Timestamp is valid ISO 8601
      expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
    });

    it("sets X-Cache header", async () => {
      const res = await request(app).get("/network/fee-percentiles");
      expect(["HIT", "MISS"]).toContain(res.headers["x-cache"]);
    });

    it("?fresh=true forces a cache MISS", async () => {
      await request(app).get("/network/fee-percentiles");
      const res = await request(app).get("/network/fee-percentiles?fresh=true");
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });
  });
});
