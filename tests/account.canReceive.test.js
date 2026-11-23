const request = require("supertest");
const app = require("../src/index");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
    },
  };
});

const { server } = require("../src/config/stellar");

describe("Account Can Receive API", () => {
  const accountId = Keypair.random().publicKey();
  const issuerPublicKey = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("canReceive: true", () => {
    it("returns canReceive true with null reason for native XLM", async () => {
      server.loadAccount.mockResolvedValue({
        id: accountId,
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      });

      const res = await request(app).get(
        `/account/${accountId}/can-receive/XLM/native`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ canReceive: true, reason: null });
    });

    it("returns canReceive true with null reason for authorized trustline with capacity", async () => {
      server.loadAccount.mockResolvedValue({
        id: accountId,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USD",
            asset_issuer: issuerPublicKey,
            balance: "50.0000000",
            limit: "1000.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: true,
          },
        ],
      });

      const res = await request(app).get(
        `/account/${accountId}/can-receive/USD/${issuerPublicKey}`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual({ canReceive: true, reason: null });
    });
  });

  describe("canReceive: false reasons", () => {
    it("returns no_trustline when trustline does not exist", async () => {
      server.loadAccount.mockResolvedValue({
        id: accountId,
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      });

      const res = await request(app).get(
        `/account/${accountId}/can-receive/USD/${issuerPublicKey}`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual({
        canReceive: false,
        reason: "no_trustline",
      });
    });

    it("returns not_authorized when trustline is unauthorized", async () => {
      server.loadAccount.mockResolvedValue({
        id: accountId,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USD",
            asset_issuer: issuerPublicKey,
            balance: "0.0000000",
            limit: "1000.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: false,
          },
        ],
      });

      const res = await request(app).get(
        `/account/${accountId}/can-receive/USD/${issuerPublicKey}`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual({
        canReceive: false,
        reason: "not_authorized",
      });
    });

    it("returns limit_reached when trustline capacity is exhausted", async () => {
      server.loadAccount.mockResolvedValue({
        id: accountId,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USD",
            asset_issuer: issuerPublicKey,
            balance: "1000.0000000",
            limit: "1000.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
            is_authorized: true,
          },
        ],
      });

      const res = await request(app).get(
        `/account/${accountId}/can-receive/USD/${issuerPublicKey}`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual({
        canReceive: false,
        reason: "limit_reached",
      });
    });

    it("returns limit_reached when buying liabilities consume remaining capacity", async () => {
      server.loadAccount.mockResolvedValue({
        id: accountId,
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USD",
            asset_issuer: issuerPublicKey,
            balance: "300.0000000",
            limit: "1000.0000000",
            buying_liabilities: "700.0000000",
            selling_liabilities: "0",
            is_authorized: true,
          },
        ],
      });

      const res = await request(app).get(
        `/account/${accountId}/can-receive/USD/${issuerPublicKey}`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual({
        canReceive: false,
        reason: "limit_reached",
      });
    });
  });

  describe("Validation", () => {
    it("returns 400 for invalid account ID", async () => {
      const res = await request(app).get(
        "/account/INVALID_ID/can-receive/USD/GA5ZSEJYB37UIUIK3VHI67YFVL2OESQ5X2Z3U5QZWAJT44PJ5G2NXFXA",
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("InvalidAccountId");
    });

    it("returns 400 for XLM with invalid issuer", async () => {
      const res = await request(app).get(
        `/account/${accountId}/can-receive/XLM/${issuerPublicKey}`,
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });

  describe("Account not found", () => {
    it("returns 404 when account does not exist", async () => {
      server.loadAccount.mockRejectedValue({
        response: {
          status: 404,
          data: { title: "Resource Not Found" },
        },
      });

      const res = await request(app).get(
        `/account/${accountId}/can-receive/USD/${issuerPublicKey}`,
      );

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
