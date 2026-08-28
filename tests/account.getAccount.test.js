/**
 * Tests for GET /account/:id
 *
 * Verifies that the endpoint:
 *   - calls server.loadAccount(id) and maps the raw Horizon response to the
 *     full StellarKit normalised shape (balances, signers, thresholds, flags,
 *     sequence, subentry count, homeDomain, lastModifiedLedger, reserveBreakdown)
 *   - returns 404 with a structured AccountNotFound error when the account
 *     does not exist on Horizon
 *   - returns 400 with a structured InvalidAccountId error for malformed IDs
 *   - sets X-Cache: MISS on the first fetch and X-Cache: HIT on a repeat
 *     request within TTL
 *   - bypasses the cache and returns X-Cache: MISS when ?fresh=true is passed
 *
 * All Stellar SDK calls are mocked; no real network requests are made.
 */
const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

// A valid 56-character Stellar public key used as the subject of every test.
const ACCOUNT_ID = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";
const ISSUER_ID  = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// Minimal Horizon account payload that exercises every mapped field.
function buildHorizonAccount(overrides = {}) {
  return {
    id: ACCOUNT_ID,
    sequence: "7654321098765",
    subentry_count: 2,
    last_modified_ledger: 4321,
    home_domain: "example.com",
    balances: [
      {
        asset_type: "native",
        balance: "100.0000000",
        buying_liabilities: "1.0000000",
        selling_liabilities: "2.0000000",
      },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: ISSUER_ID,
        balance: "50.0000000",
        limit: "1000.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
        is_authorized: true,
        is_clawback_enabled: false,
      },
    ],
    signers: [
      { key: ACCOUNT_ID, weight: 1, type: "ed25519_public_key" },
    ],
    thresholds: {
      low_threshold: 0,
      med_threshold: 0,
      high_threshold: 0,
    },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
    ...overrides,
  };
}

beforeEach(() => {
  cacheService.flush();
  jest.restoreAllMocks();
});

// ── Live data mapping ─────────────────────────────────────────────────────────

describe("GET /account/:id — normalised mapping", () => {
  it("returns 200 and the full normalised account shape", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;

    // Top-level identity fields
    expect(data.accountId).toBe(ACCOUNT_ID);
    expect(data.sequence).toBe("7654321098765");
    expect(data.subentryCount).toBe(2);
    expect(data.lastModifiedLedger).toBe(4321);
    expect(data.homeDomain).toBe("example.com");
  });

  it("maps homeDomain to null when absent from Horizon payload", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({ home_domain: undefined })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.homeDomain).toBeNull();
  });

  it("calls server.loadAccount with the correct account ID", async () => {
    const spy = jest
      .spyOn(server, "loadAccount")
      .mockResolvedValue(buildHorizonAccount());

    await request(app).get(`/account/${ACCOUNT_ID}`);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(ACCOUNT_ID);
  });
});

// ── XLM balance mapping ───────────────────────────────────────────────────────

describe("GET /account/:id — XLM balance", () => {
  it("maps the native balance entry to data.xlm with formatted values", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);

    const { xlm } = res.body.data;
    expect(xlm).toBeDefined();
    expect(xlm.balance).toBe("100.0000000");
    expect(xlm.buyingLiabilities).toBe("1.0000000");
    expect(xlm.sellingLiabilities).toBe("2.0000000");
  });

  it("returns zero XLM values when account has no native balance entry", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({ balances: [] })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);

    const { xlm } = res.body.data;
    expect(xlm.balance).toBe("0.0000000");
  });
});

// ── Asset (trustline) mapping ─────────────────────────────────────────────────

describe("GET /account/:id — assets array", () => {
  it("maps non-native balances into data.assets with normalised asset objects", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);

    const { assets, assetCount } = res.body.data;
    expect(Array.isArray(assets)).toBe(true);
    expect(assetCount).toBe(1);

    const usdc = assets[0];
    expect(usdc.asset).toEqual({
      code: "USDC",
      issuer: ISSUER_ID,
      type: "credit_alphanum4",
    });
    expect(usdc.balance).toBe("50.0000000");
    expect(usdc.limit).toBe("1000.0000000");
    expect(usdc.buyingLiabilities).toBe("0.0000000");
    expect(usdc.sellingLiabilities).toBe("0.0000000");
    expect(usdc.isAuthorized).toBe(true);
    expect(usdc.isClawbackEnabled).toBe(false);
  });

  it("returns an empty assets array and assetCount of 0 for a native-only account", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({
        balances: [
          {
            asset_type: "native",
            balance: "5.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
          },
        ],
        subentry_count: 0,
      })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.assets).toEqual([]);
    expect(res.body.data.assetCount).toBe(0);
  });

  it("maps multiple asset trustlines correctly", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({
        balances: [
          {
            asset_type: "native",
            balance: "20.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: ISSUER_ID,
            balance: "10.0000000",
            limit: "500.0000000",
            buying_liabilities: "0.0000000",
            selling_liabilities: "0.0000000",
            is_authorized: true,
            is_clawback_enabled: false,
          },
          {
            asset_type: "credit_alphanum12",
            asset_code: "STELLARTOKEN",
            asset_issuer: ISSUER_ID,
            balance: "99.0000000",
            limit: "10000.0000000",
            buying_liabilities: "0.0000000",
            selling_liabilities: "0.0000000",
            is_authorized: false,
            is_clawback_enabled: true,
          },
        ],
        subentry_count: 2,
      })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.assetCount).toBe(2);

    const [first, second] = res.body.data.assets;
    expect(first.asset.code).toBe("USDC");
    expect(first.asset.type).toBe("credit_alphanum4");
    expect(second.asset.code).toBe("STELLARTOKEN");
    expect(second.asset.type).toBe("credit_alphanum12");
    expect(second.isAuthorized).toBe(false);
    expect(second.isClawbackEnabled).toBe(true);
  });
});

// ── Signers mapping ───────────────────────────────────────────────────────────

describe("GET /account/:id — signers", () => {
  it("normalises signer type to ed25519_public_key canonical string", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);

    const { signers } = res.body.data;
    expect(Array.isArray(signers)).toBe(true);
    expect(signers).toHaveLength(1);

    const signer = signers[0];
    expect(signer.key).toBe(ACCOUNT_ID);
    expect(signer.weight).toBe(1);
    expect(signer.type).toBe("ed25519_public_key");
    expect(signer.sponsoredBy).toBeNull();
  });

  it("normalises hash_x signer type", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({
        signers: [
          { key: ACCOUNT_ID, weight: 1, type: "ed25519_public_key" },
          { key: "HASHXKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", weight: 2, type: "sha256_hash" },
        ],
      })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);

    const hashXSigner = res.body.data.signers.find((s) => s.weight === 2);
    expect(hashXSigner.type).toBe("hash_x");
  });

  it("includes sponsoredBy when signer has a sponsor field", async () => {
    const SPONSOR = "GASPONSORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({
        signers: [
          { key: ACCOUNT_ID, weight: 1, type: "ed25519_public_key", sponsor: SPONSOR },
        ],
      })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.signers[0].sponsoredBy).toBe(SPONSOR);
  });

  it("returns an empty signers array when Horizon returns no signers", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({ signers: [] })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.signers).toEqual([]);
  });
});

// ── Thresholds mapping ────────────────────────────────────────────────────────

describe("GET /account/:id — thresholds", () => {
  it("maps snake_case Horizon thresholds to camelCase keys", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
      })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);

    expect(res.body.data.thresholds).toEqual({
      lowThreshold: 1,
      medThreshold: 2,
      highThreshold: 3,
    });
  });

  it("defaults threshold values to 0 when missing from Horizon payload", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({ thresholds: {} })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);

    expect(res.body.data.thresholds).toEqual({
      lowThreshold: 0,
      medThreshold: 0,
      highThreshold: 0,
    });
  });
});

// ── Flags mapping ─────────────────────────────────────────────────────────────

describe("GET /account/:id — flags", () => {
  it("maps Horizon snake_case flags to boolean camelCase keys", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);

    expect(res.body.data.flags).toEqual({
      authRequired: false,
      authRevocable: false,
      authImmutable: false,
      clawbackEnabled: false,
    });
  });

  it("maps auth_required: true to authRequired: true", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({
        flags: {
          auth_required: true,
          auth_revocable: false,
          auth_immutable: false,
          auth_clawback_enabled: false,
        },
      })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.flags.authRequired).toBe(true);
    expect(res.body.data.flags.authRevocable).toBe(false);
  });

  it("maps auth_clawback_enabled: true to clawbackEnabled: true", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({
        flags: {
          auth_required: false,
          auth_revocable: false,
          auth_immutable: false,
          auth_clawback_enabled: true,
        },
      })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.flags.clawbackEnabled).toBe(true);
  });

  it("returns all flags as false when Horizon returns an empty flags object", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({ flags: {} })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.flags).toEqual({
      authRequired: false,
      authRevocable: false,
      authImmutable: false,
      clawbackEnabled: false,
    });
  });
});

// ── reserveBreakdown mapping ──────────────────────────────────────────────────

describe("GET /account/:id — reserveBreakdown", () => {
  it("returns correct XLM and stroops values for a 2-subentry account", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);

    // subentry_count = 2 → subentryReserve = 2 × 0.5 = 1.0
    // accountReserve = 2 × 0.5 = 1.0
    // totalLocked = 2.0, XLM balance = 100.0 → spendable = 98.0
    expect(res.body.data.reserveBreakdown).toEqual({
      baseReserve:    { xlm: "0.5000000", stroops: 5_000_000 },
      accountReserve: { xlm: "1.0000000", stroops: 10_000_000 },
      subentryReserve:{ xlm: "1.0000000", stroops: 10_000_000 },
      totalLocked:    { xlm: "2.0000000", stroops: 20_000_000 },
      spendable:      { xlm: "98.0000000", stroops: 980_000_000 },
    });
  });

  it("calculates zero subentryReserve when subentry_count is 0", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({
        subentry_count: 0,
        balances: [
          {
            asset_type: "native",
            balance: "10.0000000",
            buying_liabilities: "0",
            selling_liabilities: "0",
          },
        ],
      })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);

    const rb = res.body.data.reserveBreakdown;
    expect(rb.subentryReserve).toEqual({ xlm: "0.0000000", stroops: 0 });
    expect(rb.totalLocked).toEqual({ xlm: "1.0000000", stroops: 10_000_000 });
    expect(rb.spendable).toEqual({ xlm: "9.0000000", stroops: 90_000_000 });
  });

  it("returns negative spendable when balance is below minimum reserve", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({
        subentry_count: 0,
        balances: [
          {
            asset_type: "native",
            balance: "0.5000000",  // below the 1 XLM minimum
            buying_liabilities: "0",
            selling_liabilities: "0",
          },
        ],
      })
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);
    expect(res.statusCode).toBe(200);

    const rb = res.body.data.reserveBreakdown;
    // 0.5 - 1.0 = -0.5
    expect(rb.spendable.xlm).toBe("-0.5000000");
    expect(rb.spendable.stroops).toBe(-5_000_000);
  });
});

// ── 404 — account not found ───────────────────────────────────────────────────

describe("GET /account/:id — 404 AccountNotFound", () => {
  it("returns 404 with AccountNotFound error shape when Horizon responds with 404", async () => {
    jest.spyOn(server, "loadAccount").mockRejectedValue({
      response: { status: 404 },
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
    expect(res.body.error.message).toContain(ACCOUNT_ID);
    expect(res.body.error.message).toMatch(/testnet|mainnet/);
    expect(res.body.error.suggestion).toBe(
      "Verify the account address is correct and that the account has been funded."
    );
  });

  it("does not call loadAccount at all when account ID fails validation", async () => {
    const spy = jest.spyOn(server, "loadAccount");

    const res = await request(app).get("/account/NOT_A_VALID_KEY");

    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── 400 — invalid account ID ──────────────────────────────────────────────────

describe("GET /account/:id — 400 InvalidAccountId", () => {
  it("returns 400 with InvalidAccountId error for a too-short key", async () => {
    const res = await request(app).get("/account/GSHORT");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
  });

  it("returns 400 with a descriptive message containing the bad value", async () => {
    const res = await request(app).get("/account/BADKEY123");

    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toContain("BADKEY123");
    expect(res.body.error.suggestion).toBe(
      "Account addresses start with G and are 56 characters long."
    );
  });
});

// ── Cache behaviour ───────────────────────────────────────────────────────────

describe("GET /account/:id — caching", () => {
  it("sets X-Cache: MISS on the first fetch", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("sets X-Cache: HIT on a repeat request within TTL", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());

    await request(app).get(`/account/${ACCOUNT_ID}`);
    const second = await request(app).get(`/account/${ACCOUNT_ID}`);

    expect(second.statusCode).toBe(200);
    expect(second.headers["x-cache"]).toBe("HIT");
  });

  it("only calls loadAccount once for two requests within TTL", async () => {
    const spy = jest
      .spyOn(server, "loadAccount")
      .mockResolvedValue(buildHorizonAccount());

    await request(app).get(`/account/${ACCOUNT_ID}`);
    await request(app).get(`/account/${ACCOUNT_ID}`);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache and returns X-Cache: MISS with ?fresh=true", async () => {
    const spy = jest
      .spyOn(server, "loadAccount")
      .mockResolvedValue(buildHorizonAccount());

    await request(app).get(`/account/${ACCOUNT_ID}`);
    const fresh = await request(app).get(`/account/${ACCOUNT_ID}?fresh=true`);

    expect(fresh.statusCode).toBe(200);
    expect(fresh.headers["x-cache"]).toBe("MISS");
    // loadAccount must have been called twice — once for MISS, once for fresh
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns identical data from cache as from the live fetch", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());

    const miss = await request(app).get(`/account/${ACCOUNT_ID}`);
    const hit  = await request(app).get(`/account/${ACCOUNT_ID}`);

    expect(hit.body.data).toEqual(miss.body.data);
  });
});

// ── Response envelope ─────────────────────────────────────────────────────────

describe("GET /account/:id — response envelope", () => {
  it("wraps the response in { success: true, data: { ... } }", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(typeof res.body.data).toBe("object");
  });

  it("includes every top-level key in the normalised shape", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());

    const res = await request(app).get(`/account/${ACCOUNT_ID}`);

    const { data } = res.body;
    expect(data).toHaveProperty("accountId");
    expect(data).toHaveProperty("sequence");
    expect(data).toHaveProperty("subentryCount");
    expect(data).toHaveProperty("xlm");
    expect(data).toHaveProperty("assets");
    expect(data).toHaveProperty("assetCount");
    expect(data).toHaveProperty("signers");
    expect(data).toHaveProperty("thresholds");
    expect(data).toHaveProperty("flags");
    expect(data).toHaveProperty("homeDomain");
    expect(data).toHaveProperty("lastModifiedLedger");
    expect(data).toHaveProperty("reserveBreakdown");
  });
});
