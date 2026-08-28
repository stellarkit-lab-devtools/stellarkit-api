const request = require("supertest");
const express = require("express");
const accountRouter = require("../src/routes/account");
const { server } = require("../src/config/stellar");

jest.mock("../src/config/stellar");

const app = express();
app.use(express.json());
app.use("/account", accountRouter);

describe("GET /account/:id/balances?native=true", () => {
  const MOCK_ACCOUNT_ID = "GABC123TESTACCOUNTID456EXAMPLE789STELLAR0KEY1234567890";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("successful responses", () => {
    it("should return only native XLM balance when native=true", async () => {
      const mockAccount = {
        id: MOCK_ACCOUNT_ID,
        balances: [
          {
            asset_type: "native",
            balance: "1234.5678900",
            buying_liabilities: "0.0000000",
            selling_liabilities: "100.0000000",
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            balance: "500.0000000",
            limit: "10000.0000000",
            buying_liabilities: "0.0000000",
            selling_liabilities: "0.0000000",
            is_authorized: true,
            is_clawback_enabled: false,
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "EURC",
            asset_issuer: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
            balance: "250.0000000",
            limit: "5000.0000000",
            buying_liabilities: "0.0000000",
            selling_liabilities: "0.0000000",
            is_authorized: true,
            is_clawback_enabled: false,
          },
        ],
      };

      server.loadAccount = jest.fn().mockResolvedValue(mockAccount);

      const response = await request(app)
        .get(`/account/${MOCK_ACCOUNT_ID}/balances?native=true`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.xlm).toEqual({
        balance: "1,234.5678900",
        buyingLiabilities: "0.0000000",
        sellingLiabilities: "100.0000000",
      });
      expect(response.body.data.assets).toEqual([]);
    });

    it("should handle native=true with zero XLM balance", async () => {
      const mockAccount = {
        id: MOCK_ACCOUNT_ID,
        balances: [
          {
            asset_type: "native",
            balance: "0.0000000",
            buying_liabilities: "0.0000000",
            selling_liabilities: "0.0000000",
          },
        ],
      };

      server.loadAccount = jest.fn().mockResolvedValue(mockAccount);

      const response = await request(app)
        .get(`/account/${MOCK_ACCOUNT_ID}/balances?native=true`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.xlm.balance).toBe("0.0000000");
      expect(response.body.data.assets).toEqual([]);
    });

    it("should handle native=true when account has no assets", async () => {
      const mockAccount = {
        id: MOCK_ACCOUNT_ID,
        balances: [
          {
            asset_type: "native",
            balance: "500.0000000",
            buying_liabilities: "0.0000000",
            selling_liabilities: "0.0000000",
          },
        ],
      };

      server.loadAccount = jest.fn().mockResolvedValue(mockAccount);

      const response = await request(app)
        .get(`/account/${MOCK_ACCOUNT_ID}/balances?native=true`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.xlm.balance).toBe("500.0000000");
      expect(response.body.data.assets).toEqual([]);
    });
  });

  describe("query parameter variations", () => {
    const mockAccount = {
      id: MOCK_ACCOUNT_ID,
      balances: [
        {
          asset_type: "native",
          balance: "1000.0000000",
          buying_liabilities: "0.0000000",
          selling_liabilities: "0.0000000",
        },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          balance: "500.0000000",
          limit: "10000.0000000",
          buying_liabilities: "0.0000000",
          selling_liabilities: "0.0000000",
          is_authorized: true,
          is_clawback_enabled: false,
        },
      ],
    };

    beforeEach(() => {
      server.loadAccount = jest.fn().mockResolvedValue(mockAccount);
    });

    it('should work with native="true" (string)', async () => {
      const response = await request(app)
        .get(`/account/${MOCK_ACCOUNT_ID}/balances?native=true`)
        .expect(200);

      expect(response.body.data.assets).toEqual([]);
    });

    it("should work with native=true (boolean)", async () => {
      const response = await request(app)
        .get(`/account/${MOCK_ACCOUNT_ID}/balances`)
        .query({ native: true })
        .expect(200);

      expect(response.body.data.assets).toEqual([]);
    });

    it("should ignore native=false and return all balances", async () => {
      const response = await request(app)
        .get(`/account/${MOCK_ACCOUNT_ID}/balances?native=false`)
        .expect(200);

      expect(response.body.data.assets.length).toBe(1);
    });

    it("should ignore invalid native parameter values", async () => {
      const response = await request(app)
        .get(`/account/${MOCK_ACCOUNT_ID}/balances?native=invalid`)
        .expect(200);

      expect(response.body.data.assets.length).toBe(1);
    });
  });

  describe("interaction with assets filter", () => {
    const mockAccount = {
      id: MOCK_ACCOUNT_ID,
      balances: [
        {
          asset_type: "native",
          balance: "1000.0000000",
          buying_liabilities: "0.0000000",
          selling_liabilities: "0.0000000",
        },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          balance: "500.0000000",
          limit: "10000.0000000",
          buying_liabilities: "0.0000000",
          selling_liabilities: "0.0000000",
          is_authorized: true,
          is_clawback_enabled: false,
        },
      ],
    };

    beforeEach(() => {
      server.loadAccount = jest.fn().mockResolvedValue(mockAccount);
    });

    it("should prioritize native=true over assets filter", async () => {
      const response = await request(app)
        .get(`/account/${MOCK_ACCOUNT_ID}/balances?native=true&assets=USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`)
        .expect(200);

      expect(response.body.data.assets).toEqual([]);
      expect(response.body.data.xlm.balance).toBe("1,000.0000000");
    });

    it("should use assets filter when native=false", async () => {
      const response = await request(app)
        .get(`/account/${MOCK_ACCOUNT_ID}/balances?native=false&assets=XLM`)
        .expect(200);

      expect(response.body.data.xlm.balance).toBe("1,000.0000000");
      expect(response.body.data.assets).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("should return 404 when account does not exist", async () => {
      const error = new Error("Account not found");
      error.response = { status: 404 };
      server.loadAccount = jest.fn().mockRejectedValue(error);

      await request(app)
        .get(`/account/${MOCK_ACCOUNT_ID}/balances?native=true`)
        .expect(404);
    });

    it("should handle malformed account ID", async () => {
      await request(app)
        .get("/account/INVALID/balances?native=true")
        .expect(400);
    });
  });
});
