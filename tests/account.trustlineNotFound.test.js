/**
 * Tests for TrustlineNotFound error handling across endpoints that look up
 * a specific asset trustline on an account.
 *
 * Covered endpoints:
 *   GET /account/:id/asset-balance/:assetCode/:assetIssuer
 *   GET /account/:id/freeze-status/:assetCode/:assetIssuer
 *   GET /account/:id/can-receive/:assetCode/:assetIssuer
 */
const request = require("supertest");
const app = require("../src/index");
const { Keypair } = require("@stellar/stellar-sdk");
const cacheService = require("../src/services/cache");

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

const ACCOUNT_ID = Keypair.random().publicKey();
const ISSUER_ID = Keypair.random().publicKey();
const ASSET_CODE = "USDC";

/** Account that holds XLM only — no USDC trustline */
function accountWithoutTrustline() {
  return {
    id: ACCOUNT_ID,
    balances: [{ asset_type: "native", balance: "100.0000000" }],
  };
}

/** Account that holds the USDC trustline */
function accountWithTrustline() {
  return {
    id: ACCOUNT_ID,
    balances: [
      { asset_type: "native", balance: "100.0000000" },
      {
        asset_type: "credit_alphanum4",
        asset_code: ASSET_CODE,
        asset_issuer: ISSUER_ID,
        balance: "50.0000000",
        limit: "1000.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
        is_authorized: true,
        is_authorized_to_maintain_liabilities: true,
        is_clawback_enabled: false,
      },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  cacheService.flush();
});

// ---------------------------------------------------------------------------
// GET /account/:id/asset-balance/:assetCode/:assetIssuer
// ---------------------------------------------------------------------------
describe("GET /account/:id/asset-balance/:assetCode/:assetIssuer", () => {
  it("returns TrustlineNotFound when the trustline does not exist", async () => {
    server.loadAccount.mockResolvedValue(accountWithoutTrustline());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}?fresh=true`,
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("TrustlineNotFound");
    expect(res.body.error.message).toMatch(ACCOUNT_ID);
    expect(res.body.error.message).toMatch(`${ASSET_CODE}:${ISSUER_ID}`);
    expect(res.body.error.suggestion).toBe(
      "The account must establish a trustline before holding this asset."
    );
  });

  it("returns 200 with balance data when the trustline exists", async () => {
    server.loadAccount.mockResolvedValue(accountWithTrustline());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}?fresh=true`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.asset.code).toBe(ASSET_CODE);
  });
});

// ---------------------------------------------------------------------------
// GET /account/:id/freeze-status/:assetCode/:assetIssuer
// ---------------------------------------------------------------------------
describe("GET /account/:id/freeze-status/:assetCode/:assetIssuer", () => {
  it("returns TrustlineNotFound when the trustline does not exist", async () => {
    server.loadAccount.mockResolvedValue(accountWithoutTrustline());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/freeze-status/${ASSET_CODE}/${ISSUER_ID}`
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("TrustlineNotFound");
    expect(res.body.error.message).toMatch(ACCOUNT_ID);
    expect(res.body.error.message).toMatch(`${ASSET_CODE}:${ISSUER_ID}`);
    expect(res.body.error.suggestion).toBe(
      "The account must establish a trustline before holding this asset."
    );
  });

  it("returns 200 with freeze data when the trustline exists", async () => {
    server.loadAccount.mockResolvedValue(accountWithTrustline());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/freeze-status/${ASSET_CODE}/${ISSUER_ID}`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isFrozen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /account/:id/can-receive/:assetCode/:assetIssuer
// ---------------------------------------------------------------------------
describe("GET /account/:id/can-receive/:assetCode/:assetIssuer", () => {
  it("returns no_trustline reason when the trustline does not exist", async () => {
    server.loadAccount.mockResolvedValue(accountWithoutTrustline());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/can-receive/${ASSET_CODE}/${ISSUER_ID}`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      canReceive: false,
      reason: "no_trustline",
    });
  });

  it("returns canReceive true when the trustline exists and is authorized", async () => {
    server.loadAccount.mockResolvedValue(accountWithTrustline());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/can-receive/${ASSET_CODE}/${ISSUER_ID}`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ canReceive: true, reason: null });
  });
});

// ---------------------------------------------------------------------------
// Error shape conformance
// ---------------------------------------------------------------------------
describe("TrustlineNotFound error shape", () => {
  it("includes type, message, and suggestion fields", async () => {
    server.loadAccount.mockResolvedValue(accountWithoutTrustline());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}?fresh=true`,
    );

    expect(res.body.error).toMatchObject({
      type: "TrustlineNotFound",
      message: expect.stringContaining(ASSET_CODE),
      suggestion: expect.any(String),
    });
  });

  it("message follows the pattern: Account '<address>' does not hold a trustline for <code>:<issuer>.", async () => {
    server.loadAccount.mockResolvedValue(accountWithoutTrustline());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}?fresh=true`,
    );

    const expected = `Account '${ACCOUNT_ID}' does not hold a trustline for ${ASSET_CODE}:${ISSUER_ID}.`;
    expect(res.body.error.message).toBe(expected);
  });
});
