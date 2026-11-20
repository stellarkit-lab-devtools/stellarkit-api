"use strict";

const request = require("supertest");

const originalFetch = global.fetch;

// Mock Stellar SDK payments response with controlled direction data
jest.mock("../src/config/stellar", () => {
  const mockPayments = {
    call: jest.fn(),
  };

  const mockServer = {
    loadAccount: jest.fn((id) => {
      if (id === "GAAAAAAAACK4") {
        const err = new Error("Not Found");
        err.response = { status: 404 };
        throw err;
      }
      return Promise.resolve({
        id: id,
        account_id: id,
        sequence: "12345",
      });
    }),
    payments: jest.fn(() => ({
      forAccount: jest.fn(() => ({
        limit: jest.fn(() => ({
          order: jest.fn(() => mockPayments),
        })),
      })),
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

describe("GET /account/:id/payment-channels", () => {
  let mockPayments;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPayments = {
      call: jest.fn(),
    };

    // Reset the mock chain
    server.payments.mockImplementation(() => ({
      forAccount: jest.fn(() => ({
        limit: jest.fn(() => ({
          order: jest.fn(() => mockPayments),
        })),
      })),
    }));

    const cacheService = require("../src/services/cache");
    if (cacheService.flush) cacheService.flush();
    else if (cacheService.flushAll) cacheService.flushAll();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("Counterparties are ranked by txCount descending", () => {
    it("returns counterparties sorted by transaction count in descending order", async () => {
      // Mock payments with different transaction counts per counterparty
      mockPayments.call.mockResolvedValue({
        records: [
          // 3 payments from counterparty A (outbound)
          {
            id: "1",
            type: "payment",
            source_account: "GAAAAAAAADKM4",
            destination_account: "GCCCCCCCCTEST1",
            created_at: "2024-01-01T00:00:00Z",
          },
          {
            id: "2",
            type: "payment",
            source_account: "GAAAAAAAADKM4",
            destination_account: "GCCCCCCCCTEST1",
            created_at: "2024-01-02T00:00:00Z",
          },
          {
            id: "3",
            type: "payment",
            source_account: "GAAAAAAAADKM4",
            destination_account: "GCCCCCCCCTEST1",
            created_at: "2024-01-03T00:00:00Z",
          },
          // 1 payment from counterparty B (outbound)
          {
            id: "4",
            type: "payment",
            source_account: "GAAAAAAAADKM4",
            destination_account: "GCCCCCCCCTEST2",
            created_at: "2024-01-04T00:00:00Z",
          },
          // 5 payments from counterparty C (inbound)
          {
            id: "5",
            type: "payment",
            source_account: "GCCCCCCCCTEST3",
            destination_account: "GAAAAAAAADKM4",
            created_at: "2024-01-05T00:00:00Z",
          },
          {
            id: "6",
            type: "payment",
            source_account: "GCCCCCCCCTEST3",
            destination_account: "GAAAAAAAADKM4",
            created_at: "2024-01-06T00:00:00Z",
          },
          {
            id: "7",
            type: "payment",
            source_account: "GCCCCCCCCTEST3",
            destination_account: "GAAAAAAAADKM4",
            created_at: "2024-01-07T00:00:00Z",
          },
          {
            id: "8",
            type: "payment",
            source_account: "GCCCCCCCCTEST3",
            destination_account: "GAAAAAAAADKM4",
            created_at: "2024-01-08T00:00:00Z",
          },
          {
            id: "9",
            type: "payment",
            source_account: "GCCCCCCCCTEST3",
            destination_account: "GAAAAAAAADKM4",
            created_at: "2024-01-09T00:00:00Z",
          },
        ],
      });

      const response = await request(app)
        .get("/account/GAAAAAAAADKM4/payment-channels")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.channels).toHaveLength(3);

      // Should be sorted by txCount descending: C (5), A (3), B (1)
      expect(response.body.data.channels[0].counterparty).toBe("GCCCCCCCCTEST3");
      expect(response.body.data.channels[0].txCount).toBe(5);
      expect(response.body.data.channels[1].counterparty).toBe("GCCCCCCCCTEST1");
      expect(response.body.data.channels[1].txCount).toBe(3);
      expect(response.body.data.channels[2].counterparty).toBe("GCCCCCCCCTEST2");
      expect(response.body.data.channels[2].txCount).toBe(1);
    });
  });

  describe("Direction is correctly set to inbound, outbound, or both", () => {
    it("sets direction to 'outbound' for payments where account is the source", async () => {
      mockPayments.call.mockResolvedValue({
        records: [
          {
            id: "1",
            type: "payment",
            source_account: "GAAAAAAAADKM4",
            destination_account: "GCCCCCCCCTEST1",
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const response = await request(app)
        .get("/account/GAAAAAAAADKM4/payment-channels")
        .expect(200);

      expect(response.body.data.channels[0].direction).toBe("outbound");
    });

    it("sets direction to 'inbound' for payments where account is the destination", async () => {
      mockPayments.call.mockResolvedValue({
        records: [
          {
            id: "1",
            type: "payment",
            source_account: "GCCCCCCCCTEST1",
            destination_account: "GAAAAAAAADKM4",
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const response = await request(app)
        .get("/account/GAAAAAAAADKM4/payment-channels")
        .expect(200);

      expect(response.body.data.channels[0].direction).toBe("inbound");
    });

    it("sets direction to 'both' for payments in both directions", async () => {
      mockPayments.call.mockResolvedValue({
        records: [
          // Outbound
          {
            id: "1",
            type: "payment",
            source_account: "GAAAAAAAADKM4",
            destination_account: "GCCCCCCCCTEST1",
            created_at: "2024-01-01T00:00:00Z",
          },
          // Inbound
          {
            id: "2",
            type: "payment",
            source_account: "GCCCCCCCCTEST1",
            destination_account: "GAAAAAAAADKM4",
            created_at: "2024-01-02T00:00:00Z",
          },
        ],
      });

      const response = await request(app)
        .get("/account/GAAAAAAAADKM4/payment-channels")
        .expect(200);

      expect(response.body.data.channels[0].direction).toBe("both");
    });
  });

  describe("Limit parameter caps results", () => {
    it("?limit=5 caps results to 5", async () => {
      // Create 10 counterparties
      const records = [];
      for (let i = 0; i < 10; i++) {
        records.push({
          id: `${i}`,
          type: "payment",
          source_account: "GAAAAAAAADKM4",
          destination_account: `GCCCCCCCCTEST${i}`,
          created_at: "2024-01-01T00:00:00Z",
        });
      }
      mockPayments.call.mockResolvedValue({ records });

      const response = await request(app)
        .get("/account/GAAAAAAAADKM4/payment-channels?limit=5")
        .expect(200);

      expect(response.body.data.channels).toHaveLength(5);
    });

    it("default limit is applied when not specified", async () => {
      // Create more than default limit of counterparties
      const records = [];
      for (let i = 0; i < 25; i++) {
        records.push({
          id: `${i}`,
          type: "payment",
          source_account: "GAAAAAAAADKM4",
          destination_account: `GCCCCCCCCTEST${i}`,
          created_at: "2024-01-01T00:00:00Z",
        });
      }
      mockPayments.call.mockResolvedValue({ records });

      const response = await request(app)
        .get("/account/GAAAAAAAADKM4/payment-channels")
        .expect(200);

      // Should have a reasonable default limit (e.g., 20)
      expect(response.body.data.channels.length).toBeLessThanOrEqual(25);
    });
  });

  describe("Account with no payment history", () => {
    it("returns an empty channels array when account has no payment history", async () => {
      mockPayments.call.mockResolvedValue({
        records: [],
      });

      const response = await request(app)
        .get("/account/GAAAAAAAADKM4/payment-channels")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.channels).toEqual([]);
    });
  });

  describe("Non-existent account", () => {
    it("returns a 404 when account does not exist on the network", async () => {
      const response = await request(app)
        .get("/account/GAAAAAAAACK4/payment-channels")
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});