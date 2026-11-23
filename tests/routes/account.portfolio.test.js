/**
 * Tests for GET /account/:id/portfolio
 *
 * Verifies:
 *   1. Response includes all five top-level fields.
 *   2. totalValueXLM is computed correctly from balances.
 *   3. An account with no offers returns an empty openOffers array.
 *   4. An account with no pool positions returns an empty poolPositions array.
 *   5. A non-existent account returns 404.
 *
 * All Stellar SDK calls are mocked; no real network requests are made.
 */

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ISSUER_ID  = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function buildHorizonAccount(overrides = {}) {
  return {
    id: ACCOUNT_ID,
    sequence: "12345678901234",
    subentry_count: 1,
    last_modified_ledger: 52000000,
    balances: [
      {
        asset_type: "native",
        balance: "250.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
      },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: ISSUER_ID,
        balance: "100.0000000",
        limit: "10000.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
        is_authorized: true,
        is_clawback_enabled: false,
      },
    ],
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: {},
    signers: [],
    ...overrides,
  };
}

function buildOffersChain(records) {
  return {
    forAccount: jest.fn().mockReturnThis(),
    limit:      jest.fn().mockReturnThis(),
    order:      jest.fn().mockReturnThis(),
    call:       jest.fn().mockResolvedValue({ records }),
  };
}

beforeEach(() => {
  cacheService.flush();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /account/:id/portfolio", () => {
  it("returns all five top-level fields in the response", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());
    jest.spyOn(server, "offers").mockReturnValue(buildOffersChain([]));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/portfolio`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;
    expect(data).toHaveProperty("nativeBalance");
    expect(data).toHaveProperty("assetBalances");
    expect(data).toHaveProperty("totalValueXLM");
    expect(data).toHaveProperty("openOffers");
    expect(data).toHaveProperty("poolPositions");
  });

  it("computes totalValueXLM correctly from the native balance field", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());
    jest.spyOn(server, "offers").mockReturnValue(buildOffersChain([]));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/portfolio`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.nativeBalance).toBe("250.0000000");
    expect(res.body.data.totalValueXLM).toBe("250.0000000");
  });

  it("returns an empty openOffers array when account has no open offers", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());
    jest.spyOn(server, "offers").mockReturnValue(buildOffersChain([]));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/portfolio`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.openOffers)).toBe(true);
    expect(res.body.data.openOffers).toHaveLength(0);
  });

  it("returns an empty poolPositions array when account has no pool positions", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());
    jest.spyOn(server, "offers").mockReturnValue(buildOffersChain([]));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/portfolio`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.poolPositions)).toBe(true);
    expect(res.body.data.poolPositions).toHaveLength(0);
  });

  it("returns 404 with AccountNotFound error when account does not exist", async () => {
    const notFoundErr = new Error("Not Found");
    notFoundErr.response = { status: 404 };
    jest.spyOn(server, "loadAccount").mockRejectedValue(notFoundErr);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/portfolio`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });
});
