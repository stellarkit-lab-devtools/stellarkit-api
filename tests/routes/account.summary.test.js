/**
 * Tests for GET /account/:id/summary
 *
 * Verifies that the endpoint:
 *   1. Returns all five expected top-level fields: accountInfo, balances,
 *      recentTransactions, openOffers, and claimableBalances.
 *   2. Each field is an array or object (never null or a primitive).
 *   3. A non-existent account returns 404 with AccountNotFound error shape.
 *   4. An invalid address returns 400 with InvalidAccountId error shape.
 *
 * All Stellar SDK calls are mocked; no real network requests are made.
 */

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");
const cacheService = require("../../src/services/cache");

// A syntactically valid Stellar public key used as the subject of every test.
const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ISSUER_ID  = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// ── Mock helpers ───────────────────────────────────────────────────────────────

/**
 * Minimal Horizon account payload that exercises every mapped field in
 * the summary route (balances, signers, thresholds, flags).
 */
function buildHorizonAccount(overrides = {}) {
  return {
    id: ACCOUNT_ID,
    sequence: "12345678901234",
    subentry_count: 2,
    last_modified_ledger: 52000000,
    home_domain: "example.com",
    balances: [
      {
        asset_type: "native",
        balance: "150.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
      },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: ISSUER_ID,
        balance: "500.0000000",
        limit: "10000.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
        is_authorized: true,
        is_clawback_enabled: false,
      },
    ],
    signers: [{ key: ACCOUNT_ID, weight: 1, type: "ed25519_public_key" }],
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
    ...overrides,
  };
}

/** Builds a single minimal transaction record. */
function buildTxRecord(overrides = {}) {
  return {
    hash: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
    ledger_attr: 52000001,
    created_at: "2026-09-01T12:00:00Z",
    operation_count: 1,
    successful: true,
    memo_type: "none",
    memo: null,
    paging_token: "52000001",
    ...overrides,
  };
}

/** Builds a single minimal open offer record. */
function buildOfferRecord(overrides = {}) {
  return {
    id: "9876543",
    amount: "100.0000000",
    price: "1.5000000",
    price_r: { n: 3, d: 2 },
    selling_asset_type: "native",
    selling_asset_code: undefined,
    selling_asset_issuer: undefined,
    buying_asset_type: "credit_alphanum4",
    buying_asset_code: "USDC",
    buying_asset_issuer: ISSUER_ID,
    last_modified_ledger: 52000000,
    paging_token: "9876543",
    ...overrides,
  };
}

/** Builds a single minimal claimable balance record. */
function buildClaimableBalanceRecord(overrides = {}) {
  return {
    id: "00000000ae5b2afcab406e1e4618046cbdf9d44ee7e30a1f4cae8e3ebf4a5b8c97a2e45d",
    asset: "credit_alphanum4:USDC:" + ISSUER_ID,
    amount: "25.0000000",
    sponsor: null,
    created_at: "2026-08-15T10:00:00Z",
    claimants: [
      {
        destination: ACCOUNT_ID,
        predicate: { unconditional: true },
      },
    ],
    paging_token: "balance1",
    ...overrides,
  };
}

/**
 * Returns a chainable mock for server.transactions(), server.offers(), or
 * server.claimableBalances() that resolves with the supplied records.
 */
function buildChainableMock(records) {
  return {
    forAccount: jest.fn().mockReturnThis(),
    claimant:   jest.fn().mockReturnThis(),
    limit:      jest.fn().mockReturnThis(),
    order:      jest.fn().mockReturnThis(),
    cursor:     jest.fn().mockReturnThis(),
    call:       jest.fn().mockResolvedValue({ records }),
  };
}

// ── Setup / teardown ────────────────────────────────────────────────────────────

beforeEach(() => {
  // Flush the cache before every test so a warm entry from a prior test cannot
  // satisfy a request that should hit Horizon (or should 404).
  cacheService.flush();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Test suite ──────────────────────────────────────────────────────────────────

describe("GET /account/:id/summary", () => {
  // ── 1. All five top-level fields are present ───────────────────────────────
  it("returns all five expected top-level fields in the response", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());
    jest.spyOn(server, "transactions").mockReturnValue(buildChainableMock([buildTxRecord()]));
    jest.spyOn(server, "offers").mockReturnValue(buildChainableMock([buildOfferRecord()]));
    jest.spyOn(server, "claimableBalances").mockReturnValue(
      buildChainableMock([buildClaimableBalanceRecord()])
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}/summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data).toHaveProperty("accountInfo");
    expect(data).toHaveProperty("balances");
    expect(data).toHaveProperty("recentTransactions");
    expect(data).toHaveProperty("openOffers");
    expect(data).toHaveProperty("claimableBalances");
  });

  // ── 2. Each field is an array or object, never null ────────────────────────
  it("returns each field as an array or object and never as null", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());
    jest.spyOn(server, "transactions").mockReturnValue(
      buildChainableMock([buildTxRecord(), buildTxRecord({ hash: "ddd" })])
    );
    jest.spyOn(server, "offers").mockReturnValue(
      buildChainableMock([buildOfferRecord()])
    );
    jest.spyOn(server, "claimableBalances").mockReturnValue(
      buildChainableMock([buildClaimableBalanceRecord()])
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}/summary`);

    expect(res.statusCode).toBe(200);

    const { data } = res.body;

    // accountInfo must be a non-null object
    expect(data.accountInfo).not.toBeNull();
    expect(typeof data.accountInfo).toBe("object");
    expect(Array.isArray(data.accountInfo)).toBe(false);

    // balances must be a non-null object containing xlm and assets
    expect(data.balances).not.toBeNull();
    expect(typeof data.balances).toBe("object");
    expect(data.balances).toHaveProperty("xlm");
    expect(data.balances).toHaveProperty("assets");
    expect(Array.isArray(data.balances.assets)).toBe(true);

    // recentTransactions must be an array (not null)
    expect(Array.isArray(data.recentTransactions)).toBe(true);
    expect(data.recentTransactions).not.toBeNull();

    // openOffers must be an array (not null)
    expect(Array.isArray(data.openOffers)).toBe(true);
    expect(data.openOffers).not.toBeNull();

    // claimableBalances must be an array (not null)
    expect(Array.isArray(data.claimableBalances)).toBe(true);
    expect(data.claimableBalances).not.toBeNull();
  });

  // ── 2b. Fields contain correctly shaped items ──────────────────────────────
  it("returns correctly shaped items inside each field", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());
    jest.spyOn(server, "transactions").mockReturnValue(
      buildChainableMock([buildTxRecord()])
    );
    jest.spyOn(server, "offers").mockReturnValue(
      buildChainableMock([buildOfferRecord()])
    );
    jest.spyOn(server, "claimableBalances").mockReturnValue(
      buildChainableMock([buildClaimableBalanceRecord()])
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}/summary`);

    expect(res.statusCode).toBe(200);
    const { data } = res.body;

    // accountInfo shape
    expect(data.accountInfo).toMatchObject({
      accountId: ACCOUNT_ID,
      sequence: expect.any(String),
      subentryCount: expect.any(Number),
      thresholds: expect.any(Object),
      flags: expect.any(Object),
    });

    // balances shape
    expect(data.balances.xlm).toHaveProperty("balance");
    expect(data.balances.assets[0]).toHaveProperty("asset");
    expect(data.balances.assets[0]).toHaveProperty("balance");

    // recentTransactions shape
    const tx = data.recentTransactions[0];
    expect(tx).toHaveProperty("hash");
    expect(tx).toHaveProperty("createdAt");
    expect(tx).toHaveProperty("operationCount");
    expect(tx).toHaveProperty("successful");

    // openOffers shape
    const offer = data.openOffers[0];
    expect(offer).toHaveProperty("offerId");
    expect(offer).toHaveProperty("selling");
    expect(offer).toHaveProperty("buying");
    expect(offer).toHaveProperty("price");

    // claimableBalances shape
    const cb = data.claimableBalances[0];
    expect(cb).toHaveProperty("balanceId");
    expect(cb).toHaveProperty("amount");
    expect(cb).toHaveProperty("claimants");
    expect(Array.isArray(cb.claimants)).toBe(true);
  });

  // ── 2c. Empty arrays are returned when there is no activity ───────────────
  it("returns empty arrays for recentTransactions, openOffers, and claimableBalances when the account has no activity", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildHorizonAccount({ balances: [{ asset_type: "native", balance: "1.0000000", buying_liabilities: "0", selling_liabilities: "0" }], subentry_count: 0 })
    );
    jest.spyOn(server, "transactions").mockReturnValue(buildChainableMock([]));
    jest.spyOn(server, "offers").mockReturnValue(buildChainableMock([]));
    jest.spyOn(server, "claimableBalances").mockReturnValue(buildChainableMock([]));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.recentTransactions).toEqual([]);
    expect(res.body.data.openOffers).toEqual([]);
    expect(res.body.data.claimableBalances).toEqual([]);
  });

  // ── 3. Non-existent account returns 404 ────────────────────────────────────
  it("returns 404 with AccountNotFound error shape when the account does not exist", async () => {
    jest.spyOn(server, "loadAccount").mockRejectedValue({
      response: { status: 404 },
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/summary`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.type).toBe("AccountNotFound");
    expect(res.body.error.message).toContain(ACCOUNT_ID);
    expect(res.body.error.suggestion).toBe(
      "Verify the account address is correct and that the account has been funded."
    );
  });

  // ── 4. Invalid address returns 400 ─────────────────────────────────────────
  it("returns 400 with InvalidAccountId error shape for a malformed account address", async () => {
    const spy = jest.spyOn(server, "loadAccount");

    const res = await request(app).get("/account/NOT_A_VALID_KEY/summary");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.type).toBe("InvalidAccountId");
    // loadAccount must NOT be called for an invalid ID
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns 400 for a too-short key on the summary endpoint", async () => {
    const res = await request(app).get("/account/GSHORT/summary");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
    expect(res.body.error.suggestion).toBe(
      "Account addresses start with G and are 56 characters long."
    );
  });
});
