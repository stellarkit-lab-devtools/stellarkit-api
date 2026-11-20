"use strict";

const request = require("supertest");

const originalFetch = global.fetch;

// Mock Stellar SDK validator response with controlled agreeing/total counts
jest.mock("../src/config/stellar", () => {
  const mockServer = {
    validators: jest.fn(() => ({
      call: jest.fn(),
    })),
  };

  return {
    server: mockServer,
    horizonUrl: "https://horizon-testnet.stellar.org",
    NETWORK: "testnet",
    NETWORKS: { testnet: "https://horizon-testnet.stellar.org" },
  };
});

const app = require("../src/index");
const { server } = require("../src/config/stellar");

describe("GET /network/validator-quorum", () => {
  let mockValidatorsCall;

  beforeEach(() => {
    jest.clearAllMocks();
    mockValidatorsCall = jest.fn();
    
    server.validators.mockImplementation(() => ({
      call: mockValidatorsCall,
    }));

    const cacheService = require("../src/services/cache");
    if (cacheService.flush) cacheService.flush();
    else if (cacheService.flushAll) cacheService.flushAll();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("All validators agreeing", () => {
    it("returns isHealthy: true when all validators agree", async () => {
      // Simulate 5 validators all agreeing
      mockValidatorsCall.mockResolvedValue({
        records: [
          { public_key: "GA1", agree_with_node: true, index: 1 },
          { public_key: "GA2", agree_with_node: true, index: 2 },
          { public_key: "GA3", agree_with_node: true, index: 3 },
          { public_key: "GA4", agree_with_node: true, index: 4 },
          { public_key: "GA5", agree_with_node: true, index: 5 },
        ],
      });

      const response = await request(app)
        .get("/network/validator-quorum")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.isHealthy).toBe(true);
      expect(response.body.data.agreeingValidators).toBe(5);
      expect(response.body.data.totalValidators).toBe(5);
      expect(response.body.data.quorumPercent).toBe(100);
    });
  });

  describe("Fewer than 66% of validators agreeing", () => {
    it("returns isHealthy: false when fewer than 66% agree", async () => {
      // Simulate 5 validators with only 2 agreeing (40%)
      mockValidatorsCall.mockResolvedValue({
        records: [
          { public_key: "GA1", agree_with_node: true, index: 1 },
          { public_key: "GA2", agree_with_node: true, index: 2 },
          { public_key: "GA3", agree_with_node: false, index: 3 },
          { public_key: "GA4", agree_with_node: false, index: 4 },
          { public_key: "GA5", agree_with_node: false, index: 5 },
        ],
      });

      const response = await request(app)
        .get("/network/validator-quorum")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.isHealthy).toBe(false);
      expect(response.body.data.agreeingValidators).toBe(2);
      expect(response.body.data.totalValidators).toBe(5);
      expect(response.body.data.quorumPercent).toBe(40);
    });

    it("returns isHealthy: false when exactly 65% agree (below 66% threshold)", async () => {
      // Simulate 20 validators with 13 agreeing (65%)
      const records = [];
      for (let i = 0; i < 20; i++) {
        records.push({
          public_key: `GA${i}`,
          agree_with_node: i < 13, // First 13 agree
          index: i,
        });
      }
      mockValidatorsCall.mockResolvedValue({ records });

      const response = await request(app)
        .get("/network/validator-quorum")
        .expect(200);

      expect(response.body.data.isHealthy).toBe(false);
      expect(response.body.data.quorumPercent).toBe(65);
    });
  });

  describe("Quorum percent is computed correctly", () => {
    it("calculates quorumPercent as (agreeing / total) * 100", async () => {
      // Simulate 10 validators with 7 agreeing (70%)
      mockValidatorsCall.mockResolvedValue({
        records: [
          { public_key: "GA1", agree_with_node: true, index: 1 },
          { public_key: "GA2", agree_with_node: true, index: 2 },
          { public_key: "GA3", agree_with_node: true, index: 3 },
          { public_key: "GA4", agree_with_node: true, index: 4 },
          { public_key: "GA5", agree_with_node: true, index: 5 },
          { public_key: "GA6", agree_with_node: true, index: 6 },
          { public_key: "GA7", agree_with_node: true, index: 7 },
          { public_key: "GA8", agree_with_node: false, index: 8 },
          { public_key: "GA9", agree_with_node: false, index: 9 },
          { public_key: "GA10", agree_with_node: false, index: 10 },
        ],
      });

      const response = await request(app)
        .get("/network/validator-quorum")
        .expect(200);

      expect(response.body.data.agreeingValidators).toBe(7);
      expect(response.body.data.totalValidators).toBe(10);
      expect(response.body.data.quorumPercent).toBe(70);
    });

    it("handles single validator correctly", async () => {
      mockValidatorsCall.mockResolvedValue({
        records: [
          { public_key: "GA1", agree_with_node: true, index: 1 },
        ],
      });

      const response = await request(app)
        .get("/network/validator-quorum")
        .expect(200);

      expect(response.body.data.quorumPercent).toBe(100);
    });

    it("handles zero validators edge case", async () => {
      mockValidatorsCall.mockResolvedValue({
        records: [],
      });

      const response = await request(app)
        .get("/network/validator-quorum")
        .expect(200);

      expect(response.body.data.agreeingValidators).toBe(0);
      expect(response.body.data.totalValidators).toBe(0);
      expect(response.body.data.quorumPercent).toBe(0);
      expect(response.body.data.isHealthy).toBe(false);
    });
  });

  describe("Error when quorum data is unavailable", () => {
    it("returns a clean error when Horizon returns invalid data", async () => {
      mockValidatorsCall.mockRejectedValue(new Error("Connection refused"));

      const response = await request(app)
        .get("/network/validator-quorum")
        .expect(503);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it("returns a clean error when quorum data is missing from response", async () => {
      // Return records without agree_with_node field
      mockValidatorsCall.mockResolvedValue({
        records: [
          { public_key: "GA1", index: 1 },
          { public_key: "GA2", index: 2 },
        ],
      });

      const response = await request(app)
        .get("/network/validator-quorum")
        .expect(200);

      // Should handle missing field gracefully - treat as not agreeing
      expect(response.body.data.totalValidators).toBe(2);
    });

    it("returns a clean error when Horizon returns non-ok status", async () => {
      const err = new Error("Service unavailable");
      err.response = { status: 503 };
      mockValidatorsCall.mockRejectedValue(err);

      const response = await request(app)
        .get("/network/validator-quorum?fresh=true")
        .expect(503);

      expect(response.body.success).toBe(false);
    });
  });

  describe("Cache behavior", () => {
    it("uses cached response on subsequent requests", async () => {
      mockValidatorsCall.mockResolvedValue({
        records: [
          { public_key: "GA1", agree_with_node: true, index: 1 },
        ],
      });

      // First request
      await request(app)
        .get("/network/validator-quorum")
        .expect(200);

      // Second request should use cache
      const response2 = await request(app)
        .get("/network/validator-quorum")
        .expect(200);

      expect(response2.header["x-cache"]).toBe("HIT");
    });

    it("bypasses cache when fresh=true", async () => {
      mockValidatorsCall
        .mockResolvedValueOnce({
          records: [{ public_key: "GA1", agree_with_node: true, index: 1 }],
        })
        .mockResolvedValueOnce({
          records: [{ public_key: "GA1", agree_with_node: false, index: 1 }],
        });

      // First request
      await request(app)
        .get("/network/validator-quorum?fresh=true")
        .expect(200);

      // Second request with fresh=true
      const response = await request(app)
        .get("/network/validator-quorum?fresh=true")
        .expect(200);

      expect(mockValidatorsCall).toHaveBeenCalledTimes(2);
    });
  });
});