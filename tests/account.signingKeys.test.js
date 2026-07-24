/**
 * Tests for GET /account/:id/signing-keys
 *
 * Covers:
 *   (d) Endpoint returns correct shape with signers, masterWeight, thresholds
 *   (d) Returns 404 when the account does not exist
 *   (d) All weights are integers
 *   (a) Response is cached per account ID (X-Cache: MISS → HIT)
 *   (a) X-Cache header is always present
 *   (a) ?fresh=true bypasses the cache
 *   (b) ?weight=N returns only signers with weight >= N
 *   (b) Invalid ?weight values return 400
 *   (b) Omitting ?weight returns all signers
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: { loadAccount: jest.fn() },
  NETWORK: "testnet",
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

// Stable key fixtures so tests are deterministic
const ACCOUNT_ID = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const SIGNER_1 = Keypair.random().publicKey();
const SIGNER_2 = Keypair.random().publicKey();
const SIGNER_3 = Keypair.random().publicKey();
const SPONSOR = Keypair.random().publicKey();

// A typical multi-sig account returned by Horizon
function makeAccountMock({ signers } = {}) {
  return {
    id: ACCOUNT_ID,
    signers: signers ?? [
      { key: ACCOUNT_ID, weight: 1, type: "ed25519_public_key" },
      { key: SIGNER_1, weight: 2, type: "ed25519_public_key" },
      { key: SIGNER_2, weight: 3, type: "ed25519_public_key" },
    ],
    thresholds: {
      low_threshold: 1,
      med_threshold: 3,
      high_threshold: 5,
    },
    balances: [],
    sequence: "1",
    subentry_count: 0,
    last_modified_ledger: 1,
    flags: {},
    home_domain: null,
  };
}

describe("GET /account/:id/signing-keys", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // ── (d) Response shape ───────────────────────────────────────────────────

  it("returns success:true with signers, masterWeight and thresholds", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    const res = await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data).toHaveProperty("signers");
    expect(data).toHaveProperty("masterWeight");
    expect(data).toHaveProperty("thresholds");
    expect(data.thresholds).toEqual({ low: 1, medium: 3, high: 5 });
    expect(Array.isArray(data.signers)).toBe(true);
  });

  it("normalises each signer with key, weight, and type", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    const res = await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);

    expect(res.statusCode).toBe(200);
    const signer = res.body.data.signers[0];
    expect(signer).toHaveProperty("key");
    expect(signer).toHaveProperty("weight");
    expect(signer).toHaveProperty("type");
  });

  it("all weights in signers array are integers", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    const res = await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);

    expect(res.statusCode).toBe(200);
    res.body.data.signers.forEach((s) => {
      expect(Number.isInteger(s.weight)).toBe(true);
    });
    expect(Number.isInteger(res.body.data.masterWeight)).toBe(true);
    expect(Number.isInteger(res.body.data.thresholds.low)).toBe(true);
    expect(Number.isInteger(res.body.data.thresholds.medium)).toBe(true);
    expect(Number.isInteger(res.body.data.thresholds.high)).toBe(true);
  });

  it("includes sponsoredBy when a signer has a sponsor", async () => {
    server.loadAccount.mockResolvedValue(
      makeAccountMock({
        signers: [
          { key: ACCOUNT_ID, weight: 1, type: "ed25519_public_key" },
          { key: SIGNER_3, weight: 1, type: "ed25519_public_key", sponsor: SPONSOR },
        ],
      }),
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);

    expect(res.statusCode).toBe(200);
    const sponsored = res.body.data.signers.find((s) => s.key === SIGNER_3);
    expect(sponsored).toBeDefined();
    expect(sponsored.sponsoredBy).toBe(SPONSOR);
  });

  it("does not include sponsoredBy when the signer has no sponsor", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    const res = await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);

    expect(res.statusCode).toBe(200);
    const unsponsored = res.body.data.signers.find((s) => s.key === ACCOUNT_ID);
    expect(unsponsored).toBeDefined();
    expect(unsponsored).not.toHaveProperty("sponsoredBy");
  });

  it("returns 404 when the account does not exist", async () => {
    const err = new Error("Not Found");
    err.response = { status: 404 };
    server.loadAccount.mockRejectedValue(err);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  it("returns 400 for an invalid account ID", async () => {
    const res = await request(app).get("/account/NOTAKEY/signing-keys");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
  });

  // ── (a) Caching ──────────────────────────────────────────────────────────

  it("sets X-Cache: MISS on first request", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    const res = await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("sets X-Cache: HIT on the second request (cached)", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);
    const res = await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("HIT");
    // Horizon is only called once — the second request is served from cache
    expect(server.loadAccount).toHaveBeenCalledTimes(1);
  });

  it("?fresh=true bypasses the cache and returns X-Cache: MISS", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    // Prime the cache
    await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);
    expect(server.loadAccount).toHaveBeenCalledTimes(1);

    // Force-fresh request should bypass and call Horizon again
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/signing-keys?fresh=true`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
  });

  it("X-Cache header is present on every response (HIT and MISS)", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    const res1 = await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);
    const res2 = await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);

    expect(res1.headers).toHaveProperty("x-cache");
    expect(res2.headers).toHaveProperty("x-cache");
  });

  // ── (b) Weight filter ────────────────────────────────────────────────────

  it("omitting ?weight returns all signers", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    const res = await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);

    expect(res.statusCode).toBe(200);
    // Default mock has 3 signers (weights 1, 2, 3)
    expect(res.body.data.signers).toHaveLength(3);
  });

  it("?weight=2 returns only signers with weight >= 2", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/signing-keys?weight=2`,
    );

    expect(res.statusCode).toBe(200);
    const { signers } = res.body.data;
    expect(signers.every((s) => s.weight >= 2)).toBe(true);
    // weights 2 and 3 pass; weight 1 is excluded
    expect(signers).toHaveLength(2);
  });

  it("?weight=3 returns only signers with weight >= 3", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/signing-keys?weight=3`,
    );

    expect(res.statusCode).toBe(200);
    const { signers } = res.body.data;
    expect(signers.every((s) => s.weight >= 3)).toBe(true);
    expect(signers).toHaveLength(1);
    expect(signers[0].key).toBe(SIGNER_2);
  });

  it("?weight=100 returns an empty signers array when none qualify", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/signing-keys?weight=100`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.signers).toHaveLength(0);
  });

  it("?weight=0 returns 400 (not a positive integer)", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/signing-keys?weight=0`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.field).toBe("weight");
  });

  it("?weight=-1 returns 400 (negative value)", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/signing-keys?weight=-1`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.field).toBe("weight");
  });

  it("?weight=abc returns 400 (non-numeric)", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/signing-keys?weight=abc`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.field).toBe("weight");
  });

  it("?weight=1.5 returns 400 (not an integer)", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/signing-keys?weight=1.5`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.field).toBe("weight");
  });

  it("weight filter works on a cached response (HIT path)", async () => {
    server.loadAccount.mockResolvedValue(makeAccountMock());

    // Prime the cache with no filter
    await request(app).get(`/account/${ACCOUNT_ID}/signing-keys`);

    // Filtered request should be a cache HIT but still apply the filter
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/signing-keys?weight=2`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("HIT");
    expect(res.body.data.signers.every((s) => s.weight >= 2)).toBe(true);
    // Horizon called only once — second request served from cache
    expect(server.loadAccount).toHaveBeenCalledTimes(1);
  });
});
