/**
 * Tests for GET /account/:id/compliance-check
 *
 * Covers:
 *  1. An account passing all checks returns passed: true and recommendation: "allow"
 *  2. An account with high risk score returns recommendation: "review" (medium)
 *     or "deny" (high)
 *  3. An account with freeze flags returns passed: false and recommendation: "deny"
 *  4. A non-existent account returns 404
 *
 * All Stellar SDK calls are mocked — no real network requests are made.
 */

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

// A syntactically valid Stellar public key used across all tests.
const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ISSUER_ID  = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// ── Mock helpers ────────────────────────────────────────────────────────────────

/**
 * Builds a minimal Horizon account object.
 * Defaults produce a low-risk profile (passes all checks).
 */
function buildAccount(overrides = {}) {
  return {
    id: ACCOUNT_ID,
    home_domain: "example.com",
    signers: [
      { key: ACCOUNT_ID, weight: 1 },
      { key: ISSUER_ID, weight: 1 },
    ],
    balances: [
      {
        asset_type: "native",
        balance: "100.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
      },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: ISSUER_ID,
        balance: "50.0000000",
        limit: "10000.0000000",
        is_authorized: true,
        is_clawback_enabled: false,
      },
    ],
    ...overrides,
  };
}

/**
 * Returns a chainable mock for server.operations().forAccount().order().limit().call()
 */
function mockOperations(records) {
  return {
    forAccount: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
}

/**
 * Returns a chainable mock for server.transactions().forAccount().order().limit().call()
 */
function mockTransactions(records) {
  return {
    forAccount: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
}

/** A single old operation (>365 days) that keeps the risk score high. */
function oldOperation() {
  return [{ created_at: "2020-01-01T00:00:00Z" }];
}

/** Array of 55 recent transactions — triggers high activity penalty. */
function manyRecentTxs() {
  return Array.from({ length: 55 }, (_, i) => ({ id: String(i) }));
}

// ── Setup / teardown ────────────────────────────────────────────────────────────

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Test suite ──────────────────────────────────────────────────────────────────

describe("GET /account/:id/compliance-check", () => {
  // ── 1. All checks pass → passed: true, recommendation: "allow" ─────────────
  it("returns passed: true and recommendation: allow when all checks pass", async () => {
    // Low-risk profile:
    //   score = 50 (base)
    //   +15 (account age > 365 days)
    //   +10 (home_domain set)
    //   +10 (multi-sig — 2 signers)
    //   +5  (trustline count ≤ 10: 1 trustline)
    //   +5  (recent activity ≤ 20: 0 transactions)
    //   = 95 → rating "low"
    // No frozen trustlines → recommendation "allow"
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildAccount());
    jest.spyOn(server, "operations").mockReturnValue(mockOperations(oldOperation()));
    jest.spyOn(server, "transactions").mockReturnValue(mockTransactions([]));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/compliance-check`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.passed).toBe(true);
    expect(res.body.data.recommendation).toBe("allow");
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
    expect(res.body.data.riskRating).toBe("low");
    expect(res.body.data.checks.riskScore.passed).toBe(true);
    expect(res.body.data.checks.freezeFlags.passed).toBe(true);
    expect(res.body.data.checks.freezeFlags.frozenAssets).toHaveLength(0);
  });

  // ── 2. High risk score → recommendation: "review" or "deny" ────────────────
  it("returns recommendation: review for a medium-risk account", async () => {
    // Medium-risk profile:
    //   score = 50 (base)
    //   -15 (account age < 30 days — very new)
    //   -5  (no home_domain)
    //    0  (single signer, no bonus)
    //   +5  (trustline count ≤ 10)
    //   +5  (low recent activity)
    //   = 40 → boundary of "medium" (score >= 40)
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildAccount({
        home_domain: null,
        signers: [{ key: ACCOUNT_ID, weight: 1 }],
      })
    );
    jest.spyOn(server, "operations").mockReturnValue(
      // Very recent operation — account is brand-new
      mockOperations([{ created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() }])
    );
    jest.spyOn(server, "transactions").mockReturnValue(mockTransactions([]));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/compliance-check`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // Medium risk → recommendation is "review" (passed stays true)
    expect(res.body.data.recommendation).toBe("review");
    expect(res.body.data.riskRating).toBe("medium");
    expect(res.body.data.checks.riskScore.passed).toBe(true);
  });

  it("returns recommendation: deny for a high-risk account", async () => {
    // High-risk profile:
    //   score = 50 (base)
    //   -15 (very new account)
    //   -5  (no home_domain)
    //    0  (single signer)
    //   +5  (low trustlines)
    //   -10 (very high recent activity: 55 txs)
    //   = 25 → rating "high" (< 40)
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildAccount({
        home_domain: null,
        signers: [{ key: ACCOUNT_ID, weight: 1 }],
      })
    );
    jest.spyOn(server, "operations").mockReturnValue(
      mockOperations([{ created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() }])
    );
    jest.spyOn(server, "transactions").mockReturnValue(
      mockTransactions(manyRecentTxs())
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}/compliance-check`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.passed).toBe(false);
    expect(res.body.data.recommendation).toBe("deny");
    expect(res.body.data.riskRating).toBe("high");
    expect(res.body.data.checks.riskScore.passed).toBe(false);
  });

  // ── 3. Freeze flags present → passed: false, recommendation: "deny" ─────────
  it("returns passed: false and recommendation: deny when an asset is frozen", async () => {
    // The account has a frozen (unauthorized) USDC trustline.
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      buildAccount({
        balances: [
          {
            asset_type: "native",
            balance: "100.0000000",
            buying_liabilities: "0.0000000",
            selling_liabilities: "0.0000000",
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: ISSUER_ID,
            balance: "50.0000000",
            limit: "10000.0000000",
            is_authorized: false, // ← frozen / unauthorized
            is_clawback_enabled: false,
          },
        ],
      })
    );
    jest.spyOn(server, "operations").mockReturnValue(mockOperations(oldOperation()));
    jest.spyOn(server, "transactions").mockReturnValue(mockTransactions([]));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/compliance-check`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.passed).toBe(false);
    expect(res.body.data.recommendation).toBe("deny");
    expect(res.body.data.checks.freezeFlags.passed).toBe(false);
    expect(res.body.data.checks.freezeFlags.frozenAssets).toContain(
      `USDC:${ISSUER_ID}`
    );
  });

  // ── 4. Non-existent account → 404 ───────────────────────────────────────────
  it("returns 404 for a non-existent account", async () => {
    const horizonError = new Error("Account not found");
    horizonError.response = { status: 404 };

    jest.spyOn(server, "loadAccount").mockRejectedValue(horizonError);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/compliance-check`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  // ── 5. Invalid account ID → 400 ─────────────────────────────────────────────
  it("returns 400 for an invalid account ID", async () => {
    const res = await request(app).get("/account/INVALID_ID/compliance-check");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
