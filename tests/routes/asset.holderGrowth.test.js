/**
 * Tests for GET /asset/:code/:issuer/holder-growth
 *
 * Covers:
 *  1. 30-day resolution with 3 trustline creations in different weeks
 *     produces 3 distinct growth entries.
 *  2. `change` is positive when holders increase (trustline created) and
 *     negative when trustlines are deleted.
 *  3. An asset with no trustline history returns an empty growth array.
 *  4. An invalid resolution returns a 400.
 *
 * The Stellar SDK trustline operation history is mocked so tests never make
 * real network requests.
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const ASSET_CODE = "USDC";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// Shared mock for the terminal `.call()` of the operations query builder.
// `server.operations().forAccount(issuer).order("desc").limit(200).call()`
// resolves to whatever this mock returns.
const mockOperationsCall = jest.fn();

jest.mock("../../src/config/stellar", () => {
  function makeChain() {
    const chain = {};
    chain.forAccount = jest.fn().mockReturnValue(chain);
    chain.order = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockReturnValue(chain);
    chain.call = mockOperationsCall;
    return chain;
  }
  return {
    server: {
      operations: jest.fn(() => makeChain()),
    },
    horizonUrl: "https://horizon-testnet.stellar.org",
    NETWORK: "testnet",
    NETWORKS: {
      testnet: "https://horizon-testnet.stellar.org",
      mainnet: "https://horizon.stellar.org",
    },
  };
});

const app = require("../../src/index");
const cacheService = require("../../src/services/cache");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Build a change_trust record that CREATES a trustline (limit > 0). */
function makeAddTrustline(timestampMs, trustor) {
  return {
    type: "change_trust",
    asset_code: ASSET_CODE,
    asset_issuer: ISSUER,
    asset_type: "credit_alphanum4",
    limit: "1000", // limit > 0 → trustline added
    trustor: trustor || Keypair.random().publicKey(),
    created_at: new Date(timestampMs).toISOString(),
  };
}

/** Build a change_trust record that REMOVES a trustline (limit === 0). */
function makeRemoveTrustline(timestampMs, trustor) {
  return {
    type: "change_trust",
    asset_code: ASSET_CODE,
    asset_issuer: ISSUER,
    asset_type: "credit_alphanum4",
    limit: "0", // limit === 0 → trustline removed
    trustor: trustor || Keypair.random().publicKey(),
    created_at: new Date(timestampMs).toISOString(),
  };
}

describe("GET /asset/:code/:issuer/holder-growth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // ── 1. 30-day resolution, 3 creations in different weeks → 3 entries ───────
  it("produces 3 distinct growth entries for 3 trustline creations in different weeks (30d resolution)", async () => {
    const now = Date.now();
    // Space each creation > 7 days apart so they land in different weekly
    // buckets, and keep all of them within the 30-day window.
    const twoDaysAgo = now - 2 * DAY_MS;
    const tenDaysAgo = now - 10 * DAY_MS;
    const twentyDaysAgo = now - 20 * DAY_MS;

    mockOperationsCall.mockResolvedValue({
      records: [
        makeAddTrustline(twoDaysAgo),
        makeAddTrustline(tenDaysAgo),
        makeAddTrustline(twentyDaysAgo),
      ],
    });

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ISSUER}/holder-growth?resolution=30d`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.resolution).toBe("30d");
    expect(res.body.data.growth).toHaveLength(3);

    // Buckets are oldest-first; cumulative holders grow 1 → 2 → 3.
    expect(res.body.data.growth[0].holders).toBe(1);
    expect(res.body.data.growth[1].holders).toBe(2);
    expect(res.body.data.growth[2].holders).toBe(3);

    // Each bucket has a net change of +1 (one creation).
    expect(res.body.data.growth.every((e) => e.change === 1)).toBe(true);
    expect(res.body.data.growth.every((e) => e.added === 1)).toBe(true);
    expect(res.body.data.growth.every((e) => e.removed === 0)).toBe(true);

    // Three distinct bucket dates.
    const dates = res.body.data.growth.map((e) => e.date);
    expect(new Set(dates).size).toBe(3);

    // Sanity check: dates are sorted ascending (oldest first).
    expect(dates[0] < dates[1]).toBe(true);
    expect(dates[1] < dates[2]).toBe(true);
  });

  // ── 2. Positive change on creation, negative on deletion ──────────────────
  it("reports positive change for trustline creations and negative change for trustline deletions", async () => {
    const now = Date.now();
    // Use the 7d resolution (daily buckets) and space the ops 2 days apart so
    // they fall into distinct daily buckets. Add first (older), remove later.
    const threeDaysAgo = now - 3 * DAY_MS;
    const oneDayAgo = now - 1 * DAY_MS;

    mockOperationsCall.mockResolvedValue({
      records: [
        makeAddTrustline(threeDaysAgo), // +1 (older bucket)
        makeRemoveTrustline(oneDayAgo), // -1 (newer bucket)
      ],
    });

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ISSUER}/holder-growth?resolution=7d`,
    );

    expect(res.statusCode).toBe(200);
    const growth = res.body.data.growth;

    expect(growth).toHaveLength(2);

    // Oldest bucket — trustline created → positive change.
    expect(growth[0].change).toBe(1);
    expect(growth[0].added).toBe(1);
    expect(growth[0].removed).toBe(0);
    expect(growth[0].holders).toBe(1);

    // Newest bucket — trustline deleted → negative change.
    expect(growth[1].change).toBe(-1);
    expect(growth[1].added).toBe(0);
    expect(growth[1].removed).toBe(1);
    // Cumulative holders drop back to 0 after the removal.
    expect(growth[1].holders).toBe(0);
  });

  // ── 3. No trustline history → empty growth array ──────────────────────────
  it("returns an empty growth array when the asset has no trustline history", async () => {
    mockOperationsCall.mockResolvedValue({ records: [] });

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ISSUER}/holder-growth`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.growth).toEqual([]);
    // Default resolution is 30d.
    expect(res.body.data.resolution).toBe("30d");
    expect(res.body.data.asset.code).toBe(ASSET_CODE);
    expect(res.body.data.asset.issuer).toBe(ISSUER);
  });

  // ── 4. Invalid resolution → 400 ───────────────────────────────────────────
  it("returns 400 for an invalid resolution and does not call Horizon", async () => {
    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ISSUER}/holder-growth?resolution=1y`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.message).toContain("Invalid resolution");
    expect(res.body.error.field).toBe("resolution");
    expect(res.body.error.receivedValue).toBe("1y");

    // The Stellar SDK should never be called for an invalid resolution.
    expect(mockOperationsCall).not.toHaveBeenCalled();
  });
});
