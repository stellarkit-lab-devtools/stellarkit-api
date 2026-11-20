/**
 * Tests for GET /account/:id/risk-score
 *
 * Covers:
 *  1. Low-activity account returns rating: "low"
 *  2. High-activity account exceeding the medium threshold returns rating: "medium"
 *  3. The factors array is always present, even when there are no operations
 *  4. A non-existent account returns 404
 *
 * The Stellar SDK (server) is fully mocked so tests never hit Horizon.
 */

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

// A syntactically valid Stellar public key used across all test cases.
const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Builds a minimal mock Horizon account object.
 *
 * @param {object} overrides - Fields to override on the default account shape.
 */
function mockAccount(overrides = {}) {
  return {
    id: ACCOUNT_ID,
    home_domain: null,
    signers: [{ key: ACCOUNT_ID, weight: 1 }],
    balances: [{ asset_type: "native", balance: "100.0000000" }],
    ...overrides,
  };
}

/**
 * Returns a Jest mock for server.operations().forAccount().order().limit().call()
 * that resolves with the given records array.
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
 * Returns a Jest mock for server.transactions().forAccount().order().limit().call()
 * that resolves with the given records array.
 */
function mockTransactions(records) {
  return {
    forAccount: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("GET /account/:id/risk-score", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── 1. Low-activity account returns rating: "low" ──────────────────────────
  it('returns rating "low" for an old, established account with low transaction activity', async () => {
    // Account is over a year old → +15 to score
    // Has a home domain         → +10 to score
    // Multi-sig (2 signers)     → +10 to score
    // Low trustline count (0)   → +5 to score
    // 0 recent transactions     → +5 to score
    // Starting score 50 + 45 = 95 → rating "low" (≥70)
    const account = mockAccount({
      home_domain: "example.com",
      signers: [
        { key: ACCOUNT_ID, weight: 1 },
        { key: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", weight: 1 },
      ],
    });

    jest.spyOn(server, "loadAccount").mockResolvedValue(account);

    jest.spyOn(server, "operations").mockReturnValue(
      mockOperations([
        { created_at: "2020-01-01T00:00:00Z" }, // >365 days old
      ]),
    );

    jest.spyOn(server, "transactions").mockReturnValue(
      mockTransactions([]), // 0 recent transactions → low activity
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}/risk-score`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rating).toBe("low");
    expect(res.body.data.score).toBeGreaterThanOrEqual(70);
    // factors must be an array with entries
    expect(Array.isArray(res.body.data.factors)).toBe(true);
    expect(res.body.data.factors.length).toBeGreaterThan(0);
  });

  // ── 2. Score above the medium threshold returns rating: "medium" ───────────
  it('returns rating "medium" when the score falls between 40 and 69 (medium threshold)', async () => {
    // Account is 31–364 days old  → +10
    // No home domain              → -5
    // Single signer               →  0 (neutral)
    // Low trustline count (0)     → +5
    // Moderate recent tx (25)     → -5
    // Starting 50 + 5 = 55 → rating "medium" (40–69)
    const account = mockAccount({
      home_domain: null,
      signers: [{ key: ACCOUNT_ID, weight: 1 }],
    });

    // 60 days old → "over 1 month" branch (+10)
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    jest.spyOn(server, "loadAccount").mockResolvedValue(account);

    jest.spyOn(server, "operations").mockReturnValue(
      mockOperations([{ created_at: sixtyDaysAgo }]),
    );

    // 25 transactions → >20 branch → -5 to score
    jest.spyOn(server, "transactions").mockReturnValue(
      mockTransactions(Array(25).fill({ hash: "tx" })),
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}/risk-score`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rating).toBe("medium");
    expect(res.body.data.score).toBeGreaterThanOrEqual(40);
    expect(res.body.data.score).toBeLessThan(70);
  });

  // ── 3. factors array is always present, even with no operations history ─────
  it("always returns a populated factors array even when no operations are found", async () => {
    // No first operation → "neutral" age factor
    const account = mockAccount();

    jest.spyOn(server, "loadAccount").mockResolvedValue(account);

    jest.spyOn(server, "operations").mockReturnValue(
      mockOperations([]), // empty → no first op
    );

    jest.spyOn(server, "transactions").mockReturnValue(
      mockTransactions([]),
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}/risk-score`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { factors } = res.body.data;

    // factors must always be an array (never undefined/null)
    expect(Array.isArray(factors)).toBe(true);

    // Route always pushes one factor per evaluated dimension; even with no
    // operations at least the age factor and the other static factors are added.
    expect(factors.length).toBeGreaterThan(0);

    // Every factor must have the expected shape
    for (const factor of factors) {
      expect(factor).toHaveProperty("name");
      expect(factor).toHaveProperty("impact");
      expect(["positive", "negative", "neutral"]).toContain(factor.impact);
    }
  });

  // ── 4. Non-existent account returns 404 ────────────────────────────────────
  it("returns 404 when the account does not exist on the Stellar network", async () => {
    jest.spyOn(server, "loadAccount").mockRejectedValue({
      response: { status: 404 },
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/risk-score`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.type).toBe("AccountNotFound");
  });
});
