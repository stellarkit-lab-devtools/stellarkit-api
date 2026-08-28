const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: { loadAccount: jest.fn() },
  };
});

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

const ACCOUNT_ID = Keypair.random().publicKey();
const ISSUER_ID  = Keypair.random().publicKey();
const ASSET_CODE = "USDC";

const TRUSTLINE = {
  asset_type: "credit_alphanum4",
  asset_code: ASSET_CODE,
  asset_issuer: ISSUER_ID,
  balance: "100.0000000",
  limit: "10000.0000000",
  buying_liabilities: "0.0000000",
  selling_liabilities: "5.0000000",
  is_authorized: true,
};

function mockAccount(balances = [TRUSTLINE]) {
  server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID, balances });
}

const BASE_URL = `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${ISSUER_ID}`;

describe("GET /account/:id/asset-balance/:assetCode/:assetIssuer — caching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // ── Core response shape ────────────────────────────────────────────────────

  it("returns correct balance data for a held trustline", async () => {
    mockAccount();
    const res = await request(app).get(BASE_URL);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      asset: { code: ASSET_CODE, issuer: ISSUER_ID, type: "credit_alphanum4" },
      balance: "100.0000000",
      limit: "10000.0000000",
      buyingLiabilities: "0.0000000",
      sellingLiabilities: "5.0000000",
      isAuthorized: true,
    });
  });

  it("detects credit_alphanum12 type for asset codes longer than 4 characters", async () => {
    const longCode = "LONGTOKEN";
    server.loadAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      balances: [
        {
          asset_type: "credit_alphanum12",
          asset_code: longCode,
          asset_issuer: ISSUER_ID,
          balance: "50.0000000",
          limit: "500.0000000",
          buying_liabilities: "0.0000000",
          selling_liabilities: "0.0000000",
          is_authorized: true,
        },
      ],
    });

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${longCode}/${ISSUER_ID}`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.asset.type).toBe("credit_alphanum12");
  });

  // ── X-Cache header ─────────────────────────────────────────────────────────

  it("sets X-Cache: MISS on first request", async () => {
    mockAccount();
    const res = await request(app).get(BASE_URL);

    expect(res.statusCode).toBe(200);
    expect(res.get("X-Cache")).toBe("MISS");
  });

  it("sets X-Cache: HIT on second request with same key", async () => {
    mockAccount();
    await request(app).get(BASE_URL);

    const res2 = await request(app).get(BASE_URL);
    expect(res2.statusCode).toBe(200);
    expect(res2.get("X-Cache")).toBe("HIT");
  });

  // ── Cache keying ───────────────────────────────────────────────────────────

  it("caches per account: different account ID gets a MISS", async () => {
    mockAccount();
    await request(app).get(BASE_URL);                    // primes cache for ACCOUNT_ID

    const otherAccount = Keypair.random().publicKey();
    server.loadAccount.mockResolvedValue({ id: otherAccount, balances: [TRUSTLINE] });
    const res = await request(app).get(
      `/account/${otherAccount}/asset-balance/${ASSET_CODE}/${ISSUER_ID}`,
    );

    expect(res.get("X-Cache")).toBe("MISS");
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
  });

  it("caches per asset code: different code gets a MISS", async () => {
    mockAccount();
    await request(app).get(BASE_URL);

    server.loadAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      balances: [
        {
          asset_type: "credit_alphanum4",
          asset_code: "EURC",
          asset_issuer: ISSUER_ID,
          balance: "20.0000000",
          limit: "1000.0000000",
          buying_liabilities: "0.0000000",
          selling_liabilities: "0.0000000",
          is_authorized: true,
        },
      ],
    });

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/EURC/${ISSUER_ID}`,
    );
    expect(res.get("X-Cache")).toBe("MISS");
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
  });

  it("caches per issuer: different issuer gets a MISS", async () => {
    mockAccount();
    await request(app).get(BASE_URL);

    const otherIssuer = Keypair.random().publicKey();
    server.loadAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      balances: [
        { ...TRUSTLINE, asset_issuer: otherIssuer },
      ],
    });

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-balance/${ASSET_CODE}/${otherIssuer}`,
    );
    expect(res.get("X-Cache")).toBe("MISS");
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
  });

  // ── Horizon call deduplication ─────────────────────────────────────────────

  it("calls loadAccount only once for repeated identical requests", async () => {
    mockAccount();
    await request(app).get(BASE_URL);
    await request(app).get(BASE_URL);
    await request(app).get(BASE_URL);

    expect(server.loadAccount).toHaveBeenCalledTimes(1);
  });

  // ── ?fresh=true bypass ─────────────────────────────────────────────────────

  it("bypasses cache and returns MISS when ?fresh=true", async () => {
    mockAccount();
    const res1 = await request(app).get(BASE_URL);
    expect(res1.get("X-Cache")).toBe("MISS");
    expect(server.loadAccount).toHaveBeenCalledTimes(1);

    // Second call without fresh — should hit cache, no extra Horizon call
    const res2 = await request(app).get(BASE_URL);
    expect(res2.get("X-Cache")).toBe("HIT");
    expect(server.loadAccount).toHaveBeenCalledTimes(1);
  });

  it("calls Horizon again and returns MISS when ?fresh=true after a cached entry", async () => {
    mockAccount();
    await request(app).get(BASE_URL);               // primes cache
    expect(server.loadAccount).toHaveBeenCalledTimes(1);

    mockAccount();
    const freshRes = await request(app).get(`${BASE_URL}?fresh=true`);
    expect(freshRes.statusCode).toBe(200);
    expect(freshRes.get("X-Cache")).toBe("MISS");
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
  });

  it("repopulates the cache after a fresh=true request", async () => {
    mockAccount();
    await request(app).get(`${BASE_URL}?fresh=true`);

    // Next request without fresh should now hit the freshly populated cache
    const res = await request(app).get(BASE_URL);
    expect(res.get("X-Cache")).toBe("HIT");
    expect(server.loadAccount).toHaveBeenCalledTimes(1);
  });

  // ── Error paths ────────────────────────────────────────────────────────────

  it("returns 404 when the account does not exist", async () => {
    const horizonError = new Error("Not Found");
    horizonError.response = { status: 404 };
    server.loadAccount.mockRejectedValue(horizonError);

    const res = await request(app).get(BASE_URL);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  it("returns 404 when the account exists but does not hold the asset", async () => {
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID, balances: [] });

    const res = await request(app).get(BASE_URL);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 for an invalid account ID", async () => {
    const res = await request(app).get(
      `/account/INVALID/asset-balance/${ASSET_CODE}/${ISSUER_ID}`,
    );
    expect(res.statusCode).toBe(400);
    expect(server.loadAccount).not.toHaveBeenCalled();
  });
});
