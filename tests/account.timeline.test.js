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
      operations: jest.fn(),
    },
  };
});

describe("Account Timeline API", () => {
  const accountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /account/:id/timeline", () => {
    it("returns a unified chronological array of events", async () => {
      const mockOperations = [
        {
          id: "1",
          type: "create_account",
          created_at: "2024-01-01T00:00:00Z",
          transaction_hash: "hash1",
          account: accountId,
          starting_balance: "100.0000000",
          funder: "G_FUNDER",
          paging_token: "token1",
        },
        {
          id: "2",
          type: "payment",
          created_at: "2024-01-01T01:00:00Z",
          transaction_hash: "hash2",
          from: accountId,
          to: "G_RECEIVER",
          amount: "50.0000000",
          asset_type: "native",
          paging_token: "token2",
        },
      ];

      const mockCall = jest.fn().mockResolvedValue({
        records: mockOperations,
      });

      server.operations.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: mockCall,
      });

      const res = await request(app).get(`/account/${accountId}/timeline`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].type).toBe("account_created");
      expect(res.body.data[0].description).toContain("Account created");
      expect(res.body.data[1].type).toBe("payment_sent");
      expect(res.body.data[1].description).toContain("Sent");
      expect(res.body.meta.nextCursor).toBe("token2");
    });

    it("handles received payments", async () => {
      const mockOperations = [
        {
          id: "3",
          type: "payment",
          created_at: "2024-01-01T02:00:00Z",
          transaction_hash: "hash3",
          from: "G_SENDER",
          to: accountId,
          amount: "25.0000000",
          asset_type: "native",
          paging_token: "token3",
        },
      ];

      const mockCall = jest.fn().mockResolvedValue({
        records: mockOperations,
      });

      server.operations.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: mockCall,
      });

      const res = await request(app).get(`/account/${accountId}/timeline`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].type).toBe("payment_received");
      expect(res.body.data[0].description).toContain("Received");
      expect(res.body.data[0].counterparty).toBe("G_SENDER");
    });

    it("handles trustline changes", async () => {
      const mockOperations = [
        {
          id: "4",
          type: "change_trust",
          created_at: "2024-01-01T03:00:00Z",
          transaction_hash: "hash4",
          asset_code: "USDC",
          asset_issuer: "G_ISSUER",
          limit: "1000.0000000",
          paging_token: "token4",
        },
        {
          id: "5",
          type: "change_trust",
          created_at: "2024-01-01T04:00:00Z",
          transaction_hash: "hash5",
          asset_code: "USDC",
          asset_issuer: "G_ISSUER",
          limit: "0.0000000",
          paging_token: "token5",
        },
      ];

      const mockCall = jest.fn().mockResolvedValue({
        records: mockOperations,
      });

      server.operations.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: mockCall,
      });

      const res = await request(app).get(`/account/${accountId}/timeline`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].type).toBe("trustline_added");
      expect(res.body.data[1].type).toBe("trustline_removed");
    });

    it("handles offer activity", async () => {
      const mockOperations = [
        {
          id: "6",
          type: "manage_sell_offer",
          created_at: "2024-01-01T05:00:00Z",
          transaction_hash: "hash6",
          amount: "10.0000000",
          selling_asset_type: "native",
          buying_asset_code: "USDC",
          offer_id: "0",
          paging_token: "token6",
        },
        {
          id: "7",
          type: "manage_sell_offer",
          created_at: "2024-01-01T06:00:00Z",
          transaction_hash: "hash7",
          amount: "0.0000000",
          offer_id: "123",
          paging_token: "token7",
        },
      ];

      const mockCall = jest.fn().mockResolvedValue({
        records: mockOperations,
      });

      server.operations.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: mockCall,
      });

      const res = await request(app).get(`/account/${accountId}/timeline`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].type).toBe("offer_created");
      expect(res.body.data[1].type).toBe("offer_removed");
    });

    it("validates account ID", async () => {
      const res = await request(app).get("/account/INVALID_ID/timeline");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("Invalid Stellar account ID");
    });

    it("supports limit pagination", async () => {
      const mockCall = jest.fn().mockResolvedValue({
        records: [],
      });

      const limitSpy = jest.fn().mockReturnThis();
      server.operations.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: limitSpy,
        order: jest.fn().mockReturnThis(),
        call: mockCall,
      });

      await request(app).get(`/account/${accountId}/timeline?limit=20`);
      expect(limitSpy).toHaveBeenCalledWith(20);
    });

    it("enforces max limit of 50", async () => {
      const res = await request(app).get(`/account/${accountId}/timeline?limit=100`);
      expect(res.statusCode).toBe(400);
      expect(res.body.error.message).toContain("between 1 and 50");
    });
  });
});
