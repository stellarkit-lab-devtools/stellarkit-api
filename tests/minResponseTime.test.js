"use strict";

/**
 * Tests for MIN_RESPONSE_TIME_MS padding (account enumeration timing defense).
 *
 * Coverage:
 *   - parseMinResponseTimeMs unit behaviour (valid, invalid, missing, zero)
 *   - a format-invalid account id 400 is padded to at least MIN_RESPONSE_TIME_MS
 *   - successful 2xx responses are NOT padded
 *   - Horizon 404 responses are NOT padded
 *   - a padded format rejection converges in timing with a Horizon round trip
 *
 * The env var is set BEFORE requiring the app so src/config/responseTiming
 * resolves the small test value instead of the 200ms default.
 */

process.env.MIN_RESPONSE_TIME_MS = "80";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
    trades: jest.fn(),
    payments: jest.fn(),
    operations: jest.fn(),
    offers: jest.fn(),
    transactions: jest.fn(),
    effects: jest.fn(),
    ledgers: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    }),
    feeStats: jest.fn().mockResolvedValue({
      fee_charged: { min: "100", p10: "100", p50: "200", p95: "500", p99: "1000", max: "5000" },
      last_ledger_base_fee: "100",
      ledger_capacity_usage: "0.5",
    }),
  },
  fetchAccountCreation: jest.fn(),
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");
const {
  DEFAULT_MIN_RESPONSE_TIME_MS,
  parseMinResponseTimeMs,
} = require("../src/config/responseTiming");
const {
  createMinResponseTimeMiddleware,
  isPaddedValidationError,
} = require("../src/middleware/minResponseTime");

const MIN_MS = 80;
// Timer resolution / event-loop overhead can run a millisecond or two under
// the requested delay, so allow a generous lower bound on measurements.
const TIMING_TOLERANCE_MS = 15;
const VALID_ID = Keypair.random().publicKey();

// ── Horizon mock helpers ──────────────────────────────────────────────────────

function mockTradesSuccess(records = []) {
  server.trades.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

function mockTradesHorizon404() {
  server.trades.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockRejectedValue({ response: { status: 404 } }),
  });
}

function mockTradesHorizon404WithLatency(latencyMs) {
  server.trades.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn(
      () =>
        new Promise((_resolve, reject) =>
          setTimeout(() => reject({ response: { status: 404 } }), latencyMs)
        )
    ),
  });
}

async function timedGet(url) {
  const startedAt = Date.now();
  const res = await request(app).get(url);
  return { res, elapsedMs: Date.now() - startedAt };
}

beforeEach(() => {
  cacheService.flush();
  jest.clearAllMocks();
});

// ── parseMinResponseTimeMs unit tests ─────────────────────────────────────────

describe("parseMinResponseTimeMs", () => {
  it("returns a valid numeric value unchanged", () => {
    expect(parseMinResponseTimeMs("250")).toBe(250);
    expect(parseMinResponseTimeMs(250)).toBe(250);
  });

  it("accepts 0 as a valid value (disables padding)", () => {
    expect(parseMinResponseTimeMs("0")).toBe(0);
    expect(parseMinResponseTimeMs(0)).toBe(0);
  });

  it("truncates fractional milliseconds to an integer", () => {
    expect(parseMinResponseTimeMs("120.7")).toBe(120);
  });

  it("falls back to the default for missing values", () => {
    expect(parseMinResponseTimeMs(undefined)).toBe(DEFAULT_MIN_RESPONSE_TIME_MS);
    expect(parseMinResponseTimeMs(null)).toBe(DEFAULT_MIN_RESPONSE_TIME_MS);
    expect(parseMinResponseTimeMs("")).toBe(DEFAULT_MIN_RESPONSE_TIME_MS);
    expect(parseMinResponseTimeMs("   ")).toBe(DEFAULT_MIN_RESPONSE_TIME_MS);
  });

  it("falls back to the default for invalid values", () => {
    expect(parseMinResponseTimeMs("abc")).toBe(DEFAULT_MIN_RESPONSE_TIME_MS);
    expect(parseMinResponseTimeMs(NaN)).toBe(DEFAULT_MIN_RESPONSE_TIME_MS);
    expect(parseMinResponseTimeMs(Infinity)).toBe(DEFAULT_MIN_RESPONSE_TIME_MS);
  });

  it("falls back to the default for negative values", () => {
    expect(parseMinResponseTimeMs("-1")).toBe(DEFAULT_MIN_RESPONSE_TIME_MS);
    expect(parseMinResponseTimeMs(-100)).toBe(DEFAULT_MIN_RESPONSE_TIME_MS);
  });

  it("honours a custom fallback", () => {
    expect(parseMinResponseTimeMs("nope", 42)).toBe(42);
  });
});

// ── middleware helpers + no-op behaviour ──────────────────────────────────────

describe("isPaddedValidationError", () => {
  it("accepts validation error envelopes", () => {
    expect(isPaddedValidationError({ success: false, error: { type: "InvalidAccountId" } })).toBe(true);
    expect(isPaddedValidationError({ success: false, error: { type: "ValidationError" } })).toBe(true);
    expect(isPaddedValidationError({ success: false, error: { type: "MissingParameter" } })).toBe(true);
  });

  it("rejects non-validation and malformed bodies", () => {
    expect(isPaddedValidationError({ success: false, error: { type: "AccountNotFound" } })).toBe(false);
    expect(isPaddedValidationError({ success: true, data: {} })).toBe(false);
    expect(isPaddedValidationError(null)).toBe(false);
  });

  it("is a no-op middleware when the delay is 0", () => {
    const middleware = createMinResponseTimeMiddleware({ minResponseTimeMs: 0 });
    const req = {};
    const originalJson = jest.fn();
    const res = { json: originalJson };
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    // res.json must not be wrapped when padding is disabled.
    expect(res.json).toBe(originalJson);
  });
});

// ── integration timing tests ──────────────────────────────────────────────────

describe("MIN_RESPONSE_TIME_MS padding (integration)", () => {
  it("pads a format-invalid account id 400 to at least MIN_RESPONSE_TIME_MS", async () => {
    const { res, elapsedMs } = await timedGet("/account/NOTVALID/trades");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
    expect(elapsedMs).toBeGreaterThanOrEqual(MIN_MS - TIMING_TOLERANCE_MS);
  });

  it("pads a validation 400 for a bad query parameter", async () => {
    mockTradesSuccess();
    const { res, elapsedMs } = await timedGet(
      `/account/${VALID_ID}/trades?startDate=not-a-date`
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
    expect(elapsedMs).toBeGreaterThanOrEqual(MIN_MS - TIMING_TOLERANCE_MS);
  });

  it("does NOT pad a successful 2xx response", async () => {
    mockTradesSuccess();
    const ok = await timedGet(`/account/${VALID_ID}/trades`);
    expect(ok.res.statusCode).toBe(200);

    const format = await timedGet("/account/NOTVALID/trades");
    expect(format.res.statusCode).toBe(400);

    // Difference-based assertion (robust to slow CI): the padded format
    // rejection must be meaningfully slower than the unpadded 2xx response.
    expect(format.elapsedMs - ok.elapsedMs).toBeGreaterThanOrEqual(
      MIN_MS - TIMING_TOLERANCE_MS
    );
  });

  it("does NOT pad a Horizon 404 response", async () => {
    mockTradesHorizon404();
    const horizon = await timedGet(`/account/${VALID_ID}/trades`);
    expect(horizon.res.statusCode).toBe(404);
    expect(horizon.res.body.error.type).toBe("AccountNotFound");

    const format = await timedGet("/account/NOTVALID/trades");
    expect(format.res.statusCode).toBe(400);

    // Difference-based assertion (robust to slow CI): the padded format
    // rejection must be meaningfully slower than the unpadded Horizon 404.
    expect(format.elapsedMs - horizon.elapsedMs).toBeGreaterThanOrEqual(
      MIN_MS - TIMING_TOLERANCE_MS
    );
  });

  it("converges the format rejection with a Horizon round trip within tolerance", async () => {
    // Simulate a Horizon round trip that takes about as long as the padding floor.
    mockTradesHorizon404WithLatency(MIN_MS);
    const horizon = await timedGet(`/account/${VALID_ID}/trades`);
    expect(horizon.res.statusCode).toBe(404);
    expect(horizon.elapsedMs).toBeGreaterThanOrEqual(MIN_MS - TIMING_TOLERANCE_MS);

    const format = await timedGet("/account/NOTVALID/trades");
    expect(format.res.statusCode).toBe(400);
    expect(format.elapsedMs).toBeGreaterThanOrEqual(MIN_MS - TIMING_TOLERANCE_MS);

    const deltaMs = Math.abs(format.elapsedMs - horizon.elapsedMs);
    expect(deltaMs).toBeLessThan(40);
  });
});
