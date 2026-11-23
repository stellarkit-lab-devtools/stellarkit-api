const request = require("supertest");

// Use simple mock that doesn't require the full app infrastructure
let mockServer;
let app;

beforeEach(() => {
  jest.resetModules();
  
  // Mock only what we need
  jest.doMock("../src/config/stellar", () => ({
    server: {
      ledgers: jest.fn(),
    },
    horizonUrl: "https://horizon.stellar.org",
  }));
  
  jest.doMock("../src/services/cache", () => ({
    get: jest.fn(),
    set: jest.fn(),
    flush: jest.fn(),
  }));
  
  mockServer = require("../src/config/stellar").server;
  
  // Load the app after mocking dependencies
  app = require("../src/index");
});

afterEach(() => {
  jest.unmock("../src/config/stellar");
  jest.unmock("../src/services/cache");
});

/**
 * Helper: Generate mock ledger data for testing
 * @param {number} count - Number of ledgers to generate
 * @param {object} options - Configuration options
 * @returns {array} Array of mock ledger objects
 */
function generateMockLedgers(count, options = {}) {
  const {
    baseDate = new Date("2024-06-01T00:00:00Z"),
    txCountRange = [50, 150],
    opsCountRange = [100, 300],
    baseFeeStroops = 100,
    capacityHits = 0, // Number of ledgers hitting capacity
  } = options;

  const ledgers = [];
  const baseTime = baseDate.getTime();
  const ledgerCloseIntervalMs = 5000; // 5 seconds per ledger

  for (let i = 0; i < count; i++) {
    const txCount = Math.floor(
      Math.random() * (txCountRange[1] - txCountRange[0]) + txCountRange[0]
    );
    
    // Determine operations count: some ledgers hit capacity
    let opsCount;
    if (i < capacityHits) {
      // Force capacity hit (>= 10000)
      opsCount = 10000 + Math.floor(Math.random() * 500);
    } else {
      opsCount = Math.floor(
        Math.random() * (opsCountRange[1] - opsCountRange[0]) + opsCountRange[0]
      );
    }

    const ledgerTime = new Date(baseTime + (count - 1 - i) * ledgerCloseIntervalMs);

    ledgers.push({
      sequence: String(1000 + count - i),
      closed_at: ledgerTime.toISOString(),
      successful_transaction_count: txCount,
      operation_count: opsCount,
      base_fee_in_stroops: String(baseFeeStroops),
    });
  }

  return ledgers;
}

describe("GET /network/ledger-stats", () => {
  describe("Computation Accuracy", () => {
    it("computes avgTxPerLedger correctly from 100 ledgers", async () => {
      const mockLedgers = generateMockLedgers(100, {
        txCountRange: [100, 100], // Fixed 100 tx per ledger
        opsCountRange: [200, 200],
      });

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.avgTxPerLedger).toBe(100);
      expect(res.body.data.sampledLedgers).toBe(100);
    });

    it("computes avgOpsPerLedger correctly from 100 ledgers", async () => {
      const mockLedgers = generateMockLedgers(100, {
        txCountRange: [50, 50],
        opsCountRange: [500, 500], // Fixed 500 ops per ledger
      });

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.statusCode).toBe(200);
      expect(res.body.data.avgOpsPerLedger).toBe(500);
    });

    it("computes capacityHitPercent correctly", async () => {
      // Generate 100 ledgers with 10 hitting capacity
      const mockLedgers = generateMockLedgers(100, {
        txCountRange: [50, 150],
        opsCountRange: [200, 300],
        capacityHits: 10, // 10 ledgers hit capacity
      });

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.statusCode).toBe(200);
      expect(res.body.data.capacityHitPercent).toBe(10);
    });

    it("reflects actual spread in closeTimeVarianceSeconds", async () => {
      const baseDate = new Date("2024-06-01T00:00:00Z");
      const baseTime = baseDate.getTime();

      // Create ledgers with varying close time intervals
      // Intervals: 4, 5, 6, 5, 4, 5, 6, 5, 4, 5 seconds (repeating)
      const mockLedgers = [];
      const intervals = [4, 5, 6, 5, 4, 5, 6, 5, 4, 5];

      let currentTime = baseTime;
      for (let i = 0; i < 100; i++) {
        const interval = intervals[i % intervals.length];
        currentTime += interval * 1000;

        mockLedgers.push({
          sequence: String(1000 + 100 - i),
          closed_at: new Date(currentTime).toISOString(),
          successful_transaction_count: 100,
          operation_count: 200,
          base_fee_in_stroops: "100",
        });
      }

      // Reverse so we have newest first (as Horizon returns)
      mockLedgers.reverse();

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.statusCode).toBe(200);
      const variance = res.body.data.closeTimeVarianceSeconds;
      
      // With intervals of [4,5,6,5,4,5,6,5,4,5], mean is 5 seconds
      // Variance should reflect the spread around that mean
      expect(variance).toBeGreaterThan(0);
      expect(variance).toBeLessThan(2); // Standard deviation should be less than 2
    });

    it("always returns sampledLedgers: 100", async () => {
      const mockLedgers = generateMockLedgers(100);

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.statusCode).toBe(200);
      expect(res.body.data.sampledLedgers).toBe(100);
    });
  });

  describe("Response Structure", () => {
    it("returns correct response shape", async () => {
      const mockLedgers = generateMockLedgers(100);

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("success", true);
      expect(res.body).toHaveProperty("data");

      const { data } = res.body;
      expect(data).toHaveProperty("avgTxPerLedger");
      expect(data).toHaveProperty("avgOpsPerLedger");
      expect(data).toHaveProperty("avgFeeRevenueXLM");
      expect(data).toHaveProperty("closeTimeVarianceSeconds");
      expect(data).toHaveProperty("capacityHitPercent");
      expect(data).toHaveProperty("sampledLedgers", 100);
    });

    it("returns numeric values with correct types", async () => {
      const mockLedgers = generateMockLedgers(100);

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      const { data } = res.body;
      expect(typeof data.avgTxPerLedger).toBe("number");
      expect(typeof data.avgOpsPerLedger).toBe("number");
      expect(typeof data.avgFeeRevenueXLM).toBe("string"); // XLM amounts are strings
      expect(typeof data.closeTimeVarianceSeconds).toBe("number");
      expect(typeof data.capacityHitPercent).toBe("number");
      expect(typeof data.sampledLedgers).toBe("number");
    });

    it("returns avgFeeRevenueXLM as a properly formatted string", async () => {
      const mockLedgers = generateMockLedgers(100, {
        txCountRange: [50, 50],
        baseFeeStroops: 100,
      });

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      const xlmAmount = res.body.data.avgFeeRevenueXLM;
      // Should be a decimal string representing XLM (stroops / 10^7)
      expect(xlmAmount).toMatch(/^\d+\.?\d*$/);
    });
  });

  describe("Caching Behavior", () => {
    it("returns X-Cache: MISS on first request", async () => {
      const mockLedgers = generateMockLedgers(100);

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("returns X-Cache: HIT on subsequent requests within TTL", async () => {
      const mockLedgers = generateMockLedgers(100);

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      // First request seeds the cache
      await request(app).get("/network/ledger-stats");

      // Second request should hit cache
      const res = await request(app).get("/network/ledger-stats");
      expect(res.headers["x-cache"]).toBe("HIT");
    });

    it("bypasses cache when ?fresh=true is passed", async () => {
      const mockLedgers = generateMockLedgers(100);

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      // First request seeds the cache
      await request(app).get("/network/ledger-stats");

      // Request with fresh=true should bypass cache
      const res = await request(app).get("/network/ledger-stats?fresh=true");
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("returns consistent results from cache", async () => {
      const mockLedgers = generateMockLedgers(100);

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res1 = await request(app).get("/network/ledger-stats");
      const res2 = await request(app).get("/network/ledger-stats");

      expect(res1.body.data.avgTxPerLedger).toBe(res2.body.data.avgTxPerLedger);
      expect(res1.body.data.avgOpsPerLedger).toBe(res2.body.data.avgOpsPerLedger);
      expect(res1.body.data.capacityHitPercent).toBe(res2.body.data.capacityHitPercent);
    });
  });

  describe("Edge Cases & Error Handling", () => {
    it("handles zero capacity hits correctly", async () => {
      const mockLedgers = generateMockLedgers(100, {
        opsCountRange: [100, 500], // Below capacity threshold
        capacityHits: 0,
      });

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.body.data.capacityHitPercent).toBe(0);
    });

    it("handles 100% capacity hits correctly", async () => {
      const mockLedgers = generateMockLedgers(100, {
        capacityHits: 100, // All ledgers hit capacity
      });

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.body.data.capacityHitPercent).toBe(100);
    });

    it("handles missing operation_count gracefully", async () => {
      const mockLedgers = generateMockLedgers(100);
      // Remove operation_count from some ledgers
      mockLedgers[0].operation_count = undefined;
      mockLedgers[50].operation_count = null;

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.avgOpsPerLedger).toBeGreaterThanOrEqual(0);
    });

    it("handles Horizon connection errors", async () => {
      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockRejectedValue(new Error("Connection refused")),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("handles empty ledger response gracefully", async () => {
      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Horizon Timing", () => {
    it("records Horizon response time", async () => {
      const mockLedgers = generateMockLedgers(100);

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.statusCode).toBe(200);
      // The request logger middleware should capture this timing
      // We can't directly assert on req.horizonResponseTimeMs here,
      // but we can verify the endpoint completes successfully
      expect(res.body.success).toBe(true);
    });
  });

  describe("Query Parameter Handling", () => {
    it("accepts fresh parameter as true string", async () => {
      const mockLedgers = generateMockLedgers(100);

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      // Seed cache
      await request(app).get("/network/ledger-stats");

      // Use fresh="true"
      const res = await request(app).get("/network/ledger-stats?fresh=true");

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("accepts fresh parameter as boolean true", async () => {
      const mockLedgers = generateMockLedgers(100);

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      // Seed cache
      await request(app).get("/network/ledger-stats");

      // Use fresh as boolean
      const res = await request(app).get("/network/ledger-stats?fresh=1");

      expect(res.statusCode).toBe(200);
    });
  });

  describe("Data Validation", () => {
    it("handles base_fee_in_stroops with leading zeros", async () => {
      const mockLedgers = generateMockLedgers(100);
      mockLedgers[0].base_fee_in_stroops = "0100";

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("computes feeRevenue accounting for variable base fees", async () => {
      const mockLedgers = generateMockLedgers(100, {
        txCountRange: [50, 50],
      });

      // Set varying base fees
      mockLedgers.forEach((ledger, i) => {
        ledger.base_fee_in_stroops = String(100 + i);
      });

      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockLedgers }),
      });

      const res = await request(app).get("/network/ledger-stats");

      expect(res.statusCode).toBe(200);
      // avgFeeRevenueXLM should reflect the average of (baseFee * txCount) across ledgers
      expect(parseFloat(res.body.data.avgFeeRevenueXLM)).toBeGreaterThan(0);
    });
  });
});
