const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

// Mock Horizon server
jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      transactions: jest.fn(),
    },
  };
});

describe("Account Inactivity API", () => {
  const accountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /account/:id/inactivity", () => {
    it("returns active status for recent transactions (< 30 days)", async () => {
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      
      const mockTx = {
        hash: "hash_active",
        created_at: tenDaysAgo.toISOString(),
      };

      const mockCall = jest.fn().mockResolvedValue({
        records: [mockTx],
      });

      server.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: mockCall,
      });

      const res = await request(app).get(`/account/${accountId}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("active");
      expect(res.body.data.daysSinceLastTransaction).toBe(10);
      expect(res.body.data.lastTransactionHash).toBe("hash_active");
    });

    it("returns idle status for transactions between 30 and 180 days", async () => {
      const now = new Date();
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      
      const mockTx = {
        hash: "hash_idle",
        created_at: sixtyDaysAgo.toISOString(),
      };

      const mockCall = jest.fn().mockResolvedValue({
        records: [mockTx],
      });

      server.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: mockCall,
      });

      const res = await request(app).get(`/account/${accountId}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("idle");
      expect(res.body.data.daysSinceLastTransaction).toBe(60);
    });

    it("returns dormant status for transactions > 180 days", async () => {
      const now = new Date();
      const twoHundredDaysAgo = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000);
      
      const mockTx = {
        hash: "hash_dormant",
        created_at: twoHundredDaysAgo.toISOString(),
      };

      const mockCall = jest.fn().mockResolvedValue({
        records: [mockTx],
      });

      server.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: mockCall,
      });

      const res = await request(app).get(`/account/${accountId}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("dormant");
      expect(res.body.data.daysSinceLastTransaction).toBe(200);
    });

    it("returns no_transactions status when no transactions are found", async () => {
      const mockCall = jest.fn().mockResolvedValue({
        records: [],
      });

      server.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: mockCall,
      });

      const res = await request(app).get(`/account/${accountId}/inactivity`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("no_transactions");
    });

    it("validates the account ID", async () => {
      const res = await request(app).get("/account/INVALID_ID/inactivity");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
      expect(res.body.error.message).toContain("Invalid Stellar account ID");
    });
  });
});
