/**
 * tests/account.assetBalance.normalized.test.js
 * 
 * Tests the normalised response shape for GET /account/:id/asset-balance/:assetCode/:assetIssuer
 * 
 * Acceptance Criteria:
 * - Asset field follows standard { code, issuer, type } shape
 * - All amounts are seven-decimal strings
 * - Boolean fields (isAuthorized, isAuthorizedToMaintainLiabilities) are always present
 */

"use strict";

const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

jest.mock("../src/config/stellar", () => ({
  server: {
    loadAccount: jest.fn(),
  },
  NETWORK: "testnet",
}));

const ACCOUNT_ID = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const ASSET_CODE = "USDC";
const ISSUER_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function mockAccountWithTrustline(overrides = {}) {
  return {
    id: ACCOUNT_ID,
    balances: [
      {
        asset_type: "credit_alphanum4",
        asset_code: ASSET_CODE,
        asset_issuer: ISSUER_ID,
        balance: "1234.5678912",
        limit: "922337203685.4775807",
        buying_liabilities: "10.123",
        selling_liabilities: "5.456",
        is_authorized: true,
        is_authorized_to_maintain_liabilities: true,
        ...overrides,
      },
    ],
  };
}

describe("GET /account/:id/asset-balance/:assetCode/:assetIssuer — normalisation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns asset field following standard { code, issuer, type } shape", async () => {
    server.loadAccount.mockResolvedValue(mockAccountWithTrustline());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    
    const { asset } = res.body.data;
    expect(asset).toHaveProperty("code", ASSET_CODE);
    expect(asset).toHaveProperty("issuer", ISSUER_ID);
    expect(asset).toHaveProperty("type", "credit_alphanum4");
  });

  it("returns all amounts as seven-decimal strings", async () => {
    server.loadAccount.mockResolvedValue(mockAccountWithTrustline());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}`
    );

    expect(res.statusCode).toBe(200);
    const { data } = res.body;
    
    // All amount fields should be strings
    expect(typeof data.balance).toBe("string");
    expect(typeof data.limit).toBe("string");
    expect(typeof data.buyingLiabilities).toBe("string");
    expect(typeof data.sellingLiabilities).toBe("string");

    // All amounts should match 7-decimal format
    expect(data.balance).toMatch(/^\d+\.\d{7}$/);
    expect(data.limit).toMatch(/^\d+\.\d{7}$/);
    expect(data.buyingLiabilities).toMatch(/^\d+\.\d{7}$/);
    expect(data.sellingLiabilities).toMatch(/^\d+\.\d{7}$/);

    // Verify specific values are truncated to 7 decimals
    expect(data.balance).toBe("1234.5678912"); // Should preserve all decimals if <= 7
    expect(data.buyingLiabilities).toBe("10.1230000");
    expect(data.sellingLiabilities).toBe("5.4560000");
  });

  it("returns isAuthorized as boolean (true)", async () => {
    server.loadAccount.mockResolvedValue(
      mockAccountWithTrustline({ is_authorized: true })
    );

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}`
    );

    expect(res.statusCode).toBe(200);
    const { data } = res.body;
    
    expect(data).toHaveProperty("isAuthorized");
    expect(typeof data.isAuthorized).toBe("boolean");
    expect(data.isAuthorized).toBe(true);
  });

  it("returns isAuthorized as boolean (false)", async () => {
    server.loadAccount.mockResolvedValue(
      mockAccountWithTrustline({ is_authorized: false })
    );

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}`
    );

    expect(res.statusCode).toBe(200);
    const { data } = res.body;
    
    expect(data).toHaveProperty("isAuthorized");
    expect(typeof data.isAuthorized).toBe("boolean");
    expect(data.isAuthorized).toBe(false);
  });

  it("returns isAuthorizedToMaintainLiabilities as boolean (true)", async () => {
    server.loadAccount.mockResolvedValue(
      mockAccountWithTrustline({ is_authorized_to_maintain_liabilities: true })
    );

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}`
    );

    expect(res.statusCode).toBe(200);
    const { data } = res.body;
    
    expect(data).toHaveProperty("isAuthorizedToMaintainLiabilities");
    expect(typeof data.isAuthorizedToMaintainLiabilities).toBe("boolean");
    expect(data.isAuthorizedToMaintainLiabilities).toBe(true);
  });

  it("returns isAuthorizedToMaintainLiabilities as boolean (false)", async () => {
    server.loadAccount.mockResolvedValue(
      mockAccountWithTrustline({ is_authorized_to_maintain_liabilities: false })
    );

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}`
    );

    expect(res.statusCode).toBe(200);
    const { data } = res.body;
    
    expect(data).toHaveProperty("isAuthorizedToMaintainLiabilities");
    expect(typeof data.isAuthorizedToMaintainLiabilities).toBe("boolean");
    expect(data.isAuthorizedToMaintainLiabilities).toBe(false);
  });

  it("handles missing liabilities fields gracefully", async () => {
    const trustlineWithoutLiabilities = {
      asset_type: "credit_alphanum4",
      asset_code: ASSET_CODE,
      asset_issuer: ISSUER_ID,
      balance: "100.0",
      limit: "1000.0",
      is_authorized: true,
      is_authorized_to_maintain_liabilities: false,
      // buying_liabilities and selling_liabilities omitted
    };

    server.loadAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      balances: [trustlineWithoutLiabilities],
    });

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}`
    );

    expect(res.statusCode).toBe(200);
    const { data } = res.body;
    
    // Should default to "0.0000000"
    expect(data.buyingLiabilities).toBe("0.0000000");
    expect(data.sellingLiabilities).toBe("0.0000000");
  });

  it("correctly identifies credit_alphanum12 type for long asset codes", async () => {
    const LONG_CODE = "LONGASSETCODE";
    
    server.loadAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      balances: [
        {
          asset_type: "credit_alphanum12",
          asset_code: LONG_CODE,
          asset_issuer: ISSUER_ID,
          balance: "100.0",
          limit: "1000.0",
          is_authorized: true,
          is_authorized_to_maintain_liabilities: true,
        },
      ],
    });

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${LONG_CODE}/${ISSUER_ID}`
    );

    expect(res.statusCode).toBe(200);
    const { asset } = res.body.data;
    
    expect(asset.type).toBe("credit_alphanum12");
  });

  it("returns complete normalized shape with all required fields", async () => {
    server.loadAccount.mockResolvedValue(mockAccountWithTrustline());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}`
    );

    expect(res.statusCode).toBe(200);
    const { data } = res.body;
    
    // Verify all required fields are present
    expect(data).toHaveProperty("asset");
    expect(data.asset).toHaveProperty("code");
    expect(data.asset).toHaveProperty("issuer");
    expect(data.asset).toHaveProperty("type");
    expect(data).toHaveProperty("balance");
    expect(data).toHaveProperty("limit");
    expect(data).toHaveProperty("buyingLiabilities");
    expect(data).toHaveProperty("sellingLiabilities");
    expect(data).toHaveProperty("isAuthorized");
    expect(data).toHaveProperty("isAuthorizedToMaintainLiabilities");
  });
});
