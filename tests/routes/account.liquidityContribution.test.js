/**
 * Tests for GET /account/:id/liquidity-contribution — impermanent loss behaviour
 *
 * Verifies:
 *   1. A position where the asset price doubled since deposit returns a
 *      positive impermanentLossPercent.
 *   2. A position where the price is unchanged returns impermanentLossPercent: 0.
 *   3. An account with no pool positions returns an empty positions array with
 *      all totals as "0.0000000".
 *   4. A non-existent account returns 404 with AccountNotFound error shape.
 *
 * The IL formula used is the standard constant-product AMM formula:
 *   IL = 2 * sqrt(k) / (1 + k) - 1,  where k = currentPrice / depositPrice.
 *
 * Pool position and current price data are mocked — no real network requests.
 */

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

const ACCOUNT_ID  = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ISSUER_ID   = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const POOL_ID     = "dd7b1ab831c273310ddbec6f97870aa83c2fbd78ce22aded37ecbf4f3380fac7";

// ── Mock helpers ───────────────────────────────────────────────────────────────

function buildHorizonAccount(shares = "100.0000000") {
  return {
    id: ACCOUNT_ID,
    balances: [
      { asset_type: "native", balance: "500.0000000" },
      {
        asset_type: "liquidity_pool_shares",
        liquidity_pool_id: POOL_ID,
        balance: shares,
      },
    ],
  };
}

function buildHorizonAccountNoPool() {
  return {
    id: ACCOUNT_ID,
    balances: [{ asset_type: "native", balance: "500.0000000" }],
  };
}

/**
 * Builds a mock pool whose reserve ratio encodes the *current* price:
 *   currentPrice = reserveA / reserveB
 *
 * We set reserveA = 1000 XLM and derive reserveB so that the ratio matches
 * the requested current price.
 */
function buildPool(currentPrice = 1) {
  const reserveA = 1000;
  const reserveB = reserveA / currentPrice; // e.g. price=2 → reserveB=500
  return {
    id: POOL_ID,
    fee_bp: 30,
    total_shares: "1000.0000000",
    total_trustlines: 5,
    reserves: [
      { asset: "native",           amount: reserveA.toFixed(7) },
      { asset: `USDC:${ISSUER_ID}`, amount: reserveB.toFixed(7) },
    ],
  };
}

/**
 * Builds a trades page whose oldest trade encodes the *deposit* price.
 * The route picks the oldest trade as a proxy for the deposit price:
 *   depositPrice = baseAmount / counterAmount
 */
function buildTradesPage(depositPrice = 1) {
  // Construct one old trade at the deposit price
  const depositTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    records: [
      {
        base_amount: depositPrice.toFixed(7),
        counter_amount: "1.0000000",
        ledger_close_time: depositTime,
      },
    ],
  };
}

function buildTradesChain(tradesPage) {
  return {
    forLiquidityPool: jest.fn().mockReturnThis(),
    limit:            jest.fn().mockReturnThis(),
    order:            jest.fn().mockReturnThis(),
    call:             jest.fn().mockResolvedValue(tradesPage),
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  cacheService.flush();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Test suite ────────────────────────────────────────────────────────────────

describe("GET /account/:id/liquidity-contribution — impermanent loss", () => {
  // ── 1. Price doubled → positive IL ────────────────────────────────────────
  it("returns a positive impermanentLossPercent when asset price doubled since deposit", async () => {
    // depositPrice = 1 (base/counter = 1/1), currentPrice = 2 (reserveA/reserveB = 1000/500)
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());
    jest.spyOn(server, "liquidityPools").mockReturnValue({
      liquidityPoolId: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue(buildPool(2)),
      }),
    });
    jest.spyOn(server, "trades").mockReturnValue(buildTradesChain(buildTradesPage(1)));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/liquidity-contribution`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data).toHaveProperty("impermanentLossPercent");

    // IL for k=2: 2*sqrt(2)/(1+2) - 1 ≈ -0.05719... → ~5.72% positive
    const ilPercent = parseFloat(data.impermanentLossPercent);
    expect(ilPercent).toBeGreaterThan(0);
    // Standard formula gives ~5.72% for a 2× price move
    expect(ilPercent).toBeCloseTo(5.72, 0);
  });

  // ── 2. Price unchanged → IL = 0 ────────────────────────────────────────────
  it("returns impermanentLossPercent of 0 when price is unchanged since deposit", async () => {
    // depositPrice = 1, currentPrice = 1 → k = 1 → IL = 0
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccount());
    jest.spyOn(server, "liquidityPools").mockReturnValue({
      liquidityPoolId: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue(buildPool(1)),
      }),
    });
    jest.spyOn(server, "trades").mockReturnValue(buildTradesChain(buildTradesPage(1)));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/liquidity-contribution`);

    expect(res.statusCode).toBe(200);
    const ilPercent = parseFloat(res.body.data.impermanentLossPercent);
    expect(ilPercent).toBe(0);
  });

  // ── 3. No pool positions → empty positions with all totals zero ────────────
  it("returns an empty positions array with all totals as zero for an account with no pool positions", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue(buildHorizonAccountNoPool());

    const res = await request(app).get(`/account/${ACCOUNT_ID}/liquidity-contribution`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data.accountId).toBe(ACCOUNT_ID);
    expect(data.totalPositions).toBe(0);
    expect(data.positions).toEqual([]);

    // All monetary totals must be the zero seven-decimal string
    expect(data.totalDepositedXLM).toBe("0.0000000");
    expect(data.currentValueXLM).toBe("0.0000000");
    expect(data.estimatedFeesEarnedXLM).toBe("0.0000000");
    expect(data.impermanentLossPercent).toBe("0.0000000");
  });

  // ── 4. Non-existent account → 404 ─────────────────────────────────────────
  it("returns 404 with AccountNotFound error for a non-existent account", async () => {
    const notFoundErr = new Error("Not Found");
    notFoundErr.response = { status: 404 };
    jest.spyOn(server, "loadAccount").mockRejectedValue(notFoundErr);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/liquidity-contribution`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });
});
