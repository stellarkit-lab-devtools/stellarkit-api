const request = require("supertest");
const app = require("../../src/app");
const { server } = require("../../src/config/stellar");

jest.mock("../../src/config/stellar");

describe("GET /account/:id/funding-history", () => {
  const validAccountId = "GABC123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC";
  const funderAccount = "GDEF123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890DEF";
  const funderAccount2 = "GHIJ123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890HIJ";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Success Cases", () => {
    it("should return funding history with create_account operation", async () => {
      const mockAccount = {
        id: validAccountId,
        account_id: validAccountId,
        sequence: "123456",
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      };

      const mockPayments = {
        records: [
          {
            id: "payment1",
            type: "create_account",
            account: validAccountId,
            funder: funderAccount,
            starting_balance: "10.0000000",
            created_at: "2024-01-01T00:00:00Z",
            transaction_hash: "tx123",
          },
          {
            id: "payment2",
            type: "payment",
            from: funderAccount2,
            to: validAccountId,
            asset_type: "native",
            amount: "5.0000000",
            created_at: "2024-01-02T00:00:00Z",
            transaction_hash: "tx456",
          },
        ],
      };

      server.loadAccount.mockResolvedValue(mockAccount);
      
      const mockPaymentsBuilder = {
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockPayments),
      };
      
      server.payments.mockReturnValue(mockPaymentsBuilder);

      const response = await request(app).get(`/account/${validAccountId}/funding-history`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("accountId", validAccountId);
      expect(response.body.data).toHaveProperty("sources");
      expect(response.body.data).toHaveProperty("firstFundedAt");
      expect(response.body.data).toHaveProperty("totalSources");
      
      expect(response.body.data.sources).toHaveLength(2);
      expect(response.body.data.totalSources).toBe(2);
      expect(response.body.data.firstFundedAt).toBe("2024-01-01T00:00:00.000Z");
    });

    it("should sort funding sources by amount descending", async () => {
      const mockAccount = {
        id: validAccountId,
        account_id: validAccountId,
        sequence: "123456",
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      };

      const mockPayments = {
        records: [
          {
            id: "payment1",
            type: "create_account",
            account: validAccountId,
            funder: funderAccount,
            starting_balance: "5.0000000",
            created_at: "2024-01-01T00:00:00Z",
            transaction_hash: "tx123",
          },
          {
            id: "payment2",
            type: "payment",
            from: funderAccount2,
            to: validAccountId,
            asset_type: "native",
            amount: "25.0000000",
            created_at: "2024-01-02T00:00:00Z",
            transaction_hash: "tx456",
          },
        ],
      };

      server.loadAccount.mockResolvedValue(mockAccount);
      
      const mockPaymentsBuilder = {
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockPayments),
      };
      
      server.payments.mockReturnValue(mockPaymentsBuilder);

      const response = await request(app).get(`/account/${validAccountId}/funding-history`);

      expect(response.status).toBe(200);
      expect(response.body.data.sources).toHaveLength(2);
      // Should be sorted by amount descending (25 > 5)
      expect(response.body.data.sources[0].amount).toBe("25.0000000");
      expect(response.body.data.sources[0].from).toBe(funderAccount2);
      expect(response.body.data.sources[1].amount).toBe("5.0000000");
      expect(response.body.data.sources[1].from).toBe(funderAccount);
    });

    it("should handle account with no funding history", async () => {
      const mockAccount = {
        id: validAccountId,
        account_id: validAccountId,
        sequence: "123456",
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      };

      const mockPayments = {
        records: [],
      };

      server.loadAccount.mockResolvedValue(mockAccount);
      
      const mockPaymentsBuilder = {
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockPayments),
      };
      
      server.payments.mockReturnValue(mockPaymentsBuilder);

      const response = await request(app).get(`/account/${validAccountId}/funding-history`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sources).toHaveLength(0);
      expect(response.body.data.totalSources).toBe(0);
      expect(response.body.data.firstFundedAt).toBeNull();
    });

    it("should include firstFundedAt timestamp", async () => {
      const mockAccount = {
        id: validAccountId,
        account_id: validAccountId,
        sequence: "123456",
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      };

      const mockPayments = {
        records: [
          {
            id: "payment1",
            type: "create_account",
            account: validAccountId,
            funder: funderAccount,
            starting_balance: "10.0000000",
            created_at: "2024-01-15T12:30:45Z",
            transaction_hash: "tx123",
          },
        ],
      };

      server.loadAccount.mockResolvedValue(mockAccount);
      
      const mockPaymentsBuilder = {
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockPayments),
      };
      
      server.payments.mockReturnValue(mockPaymentsBuilder);

      const response = await request(app).get(`/account/${validAccountId}/funding-history`);

      expect(response.status).toBe(200);
      expect(response.body.data.firstFundedAt).toBe("2024-01-15T12:30:45.000Z");
    });

    it("should only include native XLM payments", async () => {
      const mockAccount = {
        id: validAccountId,
        account_id: validAccountId,
        sequence: "123456",
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      };

      const mockPayments = {
        records: [
          {
            id: "payment1",
            type: "payment",
            from: funderAccount,
            to: validAccountId,
            asset_type: "native",
            amount: "10.0000000",
            created_at: "2024-01-01T00:00:00Z",
            transaction_hash: "tx123",
          },
          {
            id: "payment2",
            type: "payment",
            from: funderAccount2,
            to: validAccountId,
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: "GISSUER...",
            amount: "100.0000000",
            created_at: "2024-01-02T00:00:00Z",
            transaction_hash: "tx456",
          },
        ],
      };

      server.loadAccount.mockResolvedValue(mockAccount);
      
      const mockPaymentsBuilder = {
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockPayments),
      };
      
      server.payments.mockReturnValue(mockPaymentsBuilder);

      const response = await request(app).get(`/account/${validAccountId}/funding-history`);

      expect(response.status).toBe(200);
      expect(response.body.data.sources).toHaveLength(1);
      expect(response.body.data.sources[0].amount).toBe("10.0000000");
    });

    it("should limit to 10 unique funding sources", async () => {
      const mockAccount = {
        id: validAccountId,
        account_id: validAccountId,
        sequence: "123456",
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      };

      // Create 15 different funders
      const payments = [];
      for (let i = 0; i < 15; i++) {
        payments.push({
          id: `payment${i}`,
          type: "payment",
          from: `GFUND${i}123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678${String(i).padStart(2, '0')}`,
          to: validAccountId,
          asset_type: "native",
          amount: `${i + 1}.0000000`,
          created_at: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
          transaction_hash: `tx${i}`,
        });
      }

      const mockPayments = { records: payments };

      server.loadAccount.mockResolvedValue(mockAccount);
      
      const mockPaymentsBuilder = {
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockPayments),
      };
      
      server.payments.mockReturnValue(mockPaymentsBuilder);

      const response = await request(app).get(`/account/${validAccountId}/funding-history`);

      expect(response.status).toBe(200);
      expect(response.body.data.sources.length).toBeLessThanOrEqual(10);
      expect(response.body.data.totalSources).toBeLessThanOrEqual(10);
    });

    it("should include transaction hash in funding sources", async () => {
      const mockAccount = {
        id: validAccountId,
        account_id: validAccountId,
        sequence: "123456",
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      };

      const mockPayments = {
        records: [
          {
            id: "payment1",
            type: "create_account",
            account: validAccountId,
            funder: funderAccount,
            starting_balance: "10.0000000",
            created_at: "2024-01-01T00:00:00Z",
            transaction_hash: "abc123def456",
          },
        ],
      };

      server.loadAccount.mockResolvedValue(mockAccount);
      
      const mockPaymentsBuilder = {
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockPayments),
      };
      
      server.payments.mockReturnValue(mockPaymentsBuilder);

      const response = await request(app).get(`/account/${validAccountId}/funding-history`);

      expect(response.status).toBe(200);
      expect(response.body.data.sources[0]).toHaveProperty("transactionHash", "abc123def456");
    });
  });

  describe("Error Cases", () => {
    it("should return 404 for non-existent account", async () => {
      const error = new Error("Account not found");
      error.response = { status: 404 };
      server.loadAccount.mockRejectedValue(error);

      const response = await request(app).get(`/account/${validAccountId}/funding-history`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 for invalid account ID", async () => {
      const invalidAccountId = "INVALID";

      const response = await request(app).get(`/account/${invalidAccountId}/funding-history`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });
});
