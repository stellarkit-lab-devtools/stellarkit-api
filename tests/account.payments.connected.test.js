"use strict";

/**
 * Tests for the fully-connected GET /account/:id/payments endpoint.
 *
 * Verifies:
 *   - Uses server.payments().forAccount(id) as the real data source
 *   - Maps all three payment operation types to the normalised shape:
 *       payment, path_payment_strict_send, path_payment_strict_receive
 *   - Maps create_account operations as native XLM payments
 *   - Supports limit, cursor, order query params
 *   - Supports assetCode filter (case-insensitive)
 *   - Supports assetIssuer filter in conjunction with assetCode
 *   - Supports startDate / endDate ISO 8601 filters
 *   - Returns 404 with type "AccountNotFound" when Horizon returns 404
 *   - Returns 400 for invalid account IDs
 *   - Returns empty payments array when there are no payment records
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const VALID_ACCOUNT   = Keypair.random().publicKey();
const ISSUER_USDC     = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ISSUER_EUR      = "GDKIIIL36ATREKNTZAPA9418LJ3RQRCZOLYUS5Q6PTYFWG3L3KKKKZVN";
const RECEIVER        = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      loadAccount: jest.fn(),
      payments: jest.fn(),
      operations: jest.fn(),
      offers: jest.fn(),
      transactions: jest.fn(),
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
  };
});

const app    = require("../src/index");
const { server } = require("../src/config/stellar");

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a chainable Horizon-style mock that resolves .call() with { records }.
 */
function chainResolve(records) {
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit:      jest.fn().mockReturnThis(),
    order:      jest.fn().mockReturnThis(),
    cursor:     jest.fn().mockReturnThis(),
    call:       jest.fn().mockResolvedValue({ records }),
  };
  return chain;
}

function chainReject(err) {
  return {
    forAccount: jest.fn().mockReturnThis(),
    limit:      jest.fn().mockReturnThis(),
    order:      jest.fn().mockReturnThis(),
    cursor:     jest.fn().mockReturnThis(),
    call:       jest.fn().mockRejectedValue(err),
  };
}

/** Minimal "payment" Horizon operation record. */
function makePayment(overrides = {}) {
  return {
    id:               "op-payment-1",
    type:             "payment",
    from:             VALID_ACCOUNT,
    to:               RECEIVER,
    asset_type:       "credit_alphanum4",
    asset_code:       "USDC",
    asset_issuer:     ISSUER_USDC,
    amount:           "100.0000000",
    created_at:       "2024-03-01T12:00:00Z",
    transaction_hash: "txhash-pay1",
    paging_token:     "pt-pay1",
    ...overrides,
  };
}

/** Minimal "path_payment_strict_send" record. */
function makePathPaymentStrictSend(overrides = {}) {
  return {
    id:                  "op-path-send-1",
    type:                "path_payment_strict_send",
    from:                VALID_ACCOUNT,
    to:                  RECEIVER,
    asset_type:          "credit_alphanum4",
    asset_code:          "EUR",
    asset_issuer:        ISSUER_EUR,
    amount:              "90.0000000",
    source_asset_type:   "credit_alphanum4",
    source_asset_code:   "USDC",
    source_asset_issuer: ISSUER_USDC,
    source_amount:       "95.0000000",
    created_at:          "2024-03-02T12:00:00Z",
    transaction_hash:    "txhash-path-send1",
    paging_token:        "pt-path-send1",
    ...overrides,
  };
}

/** Minimal "path_payment_strict_receive" record. */
function makePathPaymentStrictReceive(overrides = {}) {
  return {
    id:                  "op-path-recv-1",
    type:                "path_payment_strict_receive",
    from:                VALID_ACCOUNT,
    to:                  RECEIVER,
    asset_type:          "credit_alphanum4",
    asset_code:          "EUR",
    asset_issuer:        ISSUER_EUR,
    amount:              "80.0000000",
    source_asset_type:   "native",
    source_asset_code:   undefined,
    source_asset_issuer: undefined,
    source_amount:       "200.0000000",
    created_at:          "2024-03-03T12:00:00Z",
    transaction_hash:    "txhash-path-recv1",
    paging_token:        "pt-path-recv1",
    ...overrides,
  };
}

/** Minimal "create_account" record. */
function makeCreateAccount(overrides = {}) {
  return {
    id:               "op-create-1",
    type:             "create_account",
    funder:           VALID_ACCOUNT,
    account:          RECEIVER,
    starting_balance: "10.0000000",
    created_at:       "2024-03-04T12:00:00Z",
    transaction_hash: "txhash-create1",
    paging_token:     "pt-create1",
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

// ── Uses server.payments().forAccount() ───────────────────────────────────────

describe("GET /account/:id/payments — data source", () => {
  it("calls server.payments().forAccount(id)", async () => {
    const chain = chainResolve([makePayment()]);
    server.payments.mockReturnValue(chain);

    await request(app).get(`/account/${VALID_ACCOUNT}/payments`);

    expect(server.payments).toHaveBeenCalledTimes(1);
    expect(chain.forAccount).toHaveBeenCalledWith(VALID_ACCOUNT);
  });

  it("does NOT call server.operations() for the payments endpoint", async () => {
    server.payments.mockReturnValue(chainResolve([makePayment()]));

    await request(app).get(`/account/${VALID_ACCOUNT}/payments`);

    expect(server.operations).not.toHaveBeenCalled();
  });

  it("passes limit to the Horizon query", async () => {
    const chain = chainResolve([]);
    server.payments.mockReturnValue(chain);

    await request(app).get(`/account/${VALID_ACCOUNT}/payments?limit=5`);

    expect(chain.limit).toHaveBeenCalledWith(5);
  });

  it("passes order to the Horizon query", async () => {
    const chain = chainResolve([]);
    server.payments.mockReturnValue(chain);

    await request(app).get(`/account/${VALID_ACCOUNT}/payments?order=asc`);

    expect(chain.order).toHaveBeenCalledWith("asc");
  });

  it("passes cursor to the Horizon query when supplied", async () => {
    const chain = chainResolve([]);
    server.payments.mockReturnValue(chain);

    await request(app).get(`/account/${VALID_ACCOUNT}/payments?cursor=abc123`);

    expect(chain.cursor).toHaveBeenCalledWith("abc123");
  });

  it("does not call .cursor() when no cursor is given", async () => {
    const chain = chainResolve([]);
    server.payments.mockReturnValue(chain);

    await request(app).get(`/account/${VALID_ACCOUNT}/payments`);

    expect(chain.cursor).not.toHaveBeenCalled();
  });
});

// ── Normalised shape — payment ────────────────────────────────────────────────

describe("GET /account/:id/payments — payment operation type", () => {
  it("returns 200 with success: true", async () => {
    server.payments.mockReturnValue(chainResolve([makePayment()]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("maps a payment record to the normalised shape", async () => {
    server.payments.mockReturnValue(chainResolve([makePayment()]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    const p = res.body.data.payments[0];

    expect(p.paymentId).toBe("op-payment-1");
    expect(p.type).toBe("payment");
    expect(p.from).toBe(VALID_ACCOUNT);
    expect(p.to).toBe(RECEIVER);
    expect(p.asset).toEqual({ code: "USDC", issuer: ISSUER_USDC, type: "credit_alphanum4" });
    expect(p.amount).toBe("100.0000000");
    expect(p.createdAt).toBeDefined();
    expect(p.transactionHash).toBe("txhash-pay1");
  });

  it("maps native payment with XLM asset and null issuer", async () => {
    server.payments.mockReturnValue(chainResolve([
      makePayment({ asset_type: "native", asset_code: undefined, asset_issuer: undefined }),
    ]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    const p = res.body.data.payments[0];
    expect(p.asset).toEqual({ code: "XLM", issuer: null, type: "native" });
  });

  it("does not include sourceAsset/sourceAmount on plain payment", async () => {
    server.payments.mockReturnValue(chainResolve([makePayment()]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    const p = res.body.data.payments[0];
    expect(p.sourceAsset).toBeUndefined();
    expect(p.sourceAmount).toBeUndefined();
  });
});

// ── Normalised shape — path_payment_strict_send ───────────────────────────────

describe("GET /account/:id/payments — path_payment_strict_send operation type", () => {
  it("maps path_payment_strict_send to the normalised shape", async () => {
    server.payments.mockReturnValue(chainResolve([makePathPaymentStrictSend()]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    const p = res.body.data.payments[0];

    expect(p.paymentId).toBe("op-path-send-1");
    expect(p.type).toBe("path_payment_strict_send");
    expect(p.from).toBe(VALID_ACCOUNT);
    expect(p.to).toBe(RECEIVER);
    expect(p.asset).toEqual({ code: "EUR", issuer: ISSUER_EUR, type: "credit_alphanum4" });
    expect(p.amount).toBe("90.0000000");
    expect(p.transactionHash).toBe("txhash-path-send1");
  });

  it("includes sourceAsset on path_payment_strict_send", async () => {
    server.payments.mockReturnValue(chainResolve([makePathPaymentStrictSend()]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    const p = res.body.data.payments[0];

    expect(p.sourceAsset).toEqual({
      code:   "USDC",
      issuer: ISSUER_USDC,
      type:   "credit_alphanum4",
    });
    expect(p.sourceAmount).toBe("95.0000000");
  });
});

// ── Normalised shape — path_payment_strict_receive ───────────────────────────

describe("GET /account/:id/payments — path_payment_strict_receive operation type", () => {
  it("maps path_payment_strict_receive to the normalised shape", async () => {
    server.payments.mockReturnValue(chainResolve([makePathPaymentStrictReceive()]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    const p = res.body.data.payments[0];

    expect(p.paymentId).toBe("op-path-recv-1");
    expect(p.type).toBe("path_payment_strict_receive");
    expect(p.asset).toEqual({ code: "EUR", issuer: ISSUER_EUR, type: "credit_alphanum4" });
    expect(p.amount).toBe("80.0000000");
    expect(p.transactionHash).toBe("txhash-path-recv1");
  });

  it("includes native XLM sourceAsset on path_payment_strict_receive with native source", async () => {
    server.payments.mockReturnValue(chainResolve([makePathPaymentStrictReceive()]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    const p = res.body.data.payments[0];

    expect(p.sourceAsset).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(p.sourceAmount).toBe("200.0000000");
  });
});

// ── Normalised shape — create_account ────────────────────────────────────────

describe("GET /account/:id/payments — create_account operation type", () => {
  it("maps create_account to the normalised payment shape with XLM asset", async () => {
    server.payments.mockReturnValue(chainResolve([makeCreateAccount()]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    const p = res.body.data.payments[0];

    expect(p.paymentId).toBe("op-create-1");
    expect(p.type).toBe("create_account");
    expect(p.from).toBe(VALID_ACCOUNT);
    expect(p.to).toBe(RECEIVER);
    expect(p.asset).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(p.amount).toBe("10.0000000");
    expect(p.transactionHash).toBe("txhash-create1");
  });

  it("does not include sourceAsset/sourceAmount on create_account", async () => {
    server.payments.mockReturnValue(chainResolve([makeCreateAccount()]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    const p = res.body.data.payments[0];
    expect(p.sourceAsset).toBeUndefined();
    expect(p.sourceAmount).toBeUndefined();
  });
});

// ── All three types together ──────────────────────────────────────────────────

describe("GET /account/:id/payments — all operation types together", () => {
  it("handles a mixed page of all three types and returns all of them", async () => {
    server.payments.mockReturnValue(chainResolve([
      makePayment(),
      makePathPaymentStrictSend(),
      makePathPaymentStrictReceive(),
      makeCreateAccount(),
    ]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.payments).toHaveLength(4);

    const types = res.body.data.payments.map((p) => p.type);
    expect(types).toContain("payment");
    expect(types).toContain("path_payment_strict_send");
    expect(types).toContain("path_payment_strict_receive");
    expect(types).toContain("create_account");
  });
});

// ── Pagination metadata ───────────────────────────────────────────────────────

describe("GET /account/:id/payments — pagination metadata", () => {
  it("includes total, limit, and cursor in response", async () => {
    server.payments.mockReturnValue(chainResolve([makePayment()]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    const { total, limit, cursor } = res.body.data;

    expect(total).toBe(1);
    expect(typeof limit).toBe("number");
    expect(cursor).toBe("pt-pay1");
  });

  it("returns cursor: null when there are no records", async () => {
    server.payments.mockReturnValue(chainResolve([]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    expect(res.body.data.cursor).toBeNull();
    expect(res.body.data.total).toBe(0);
  });

  it("cursor is the paging_token of the last record", async () => {
    server.payments.mockReturnValue(chainResolve([
      makePayment({ paging_token: "pt-1" }),
      makeCreateAccount({ paging_token: "pt-2" }),
    ]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    expect(res.body.data.cursor).toBe("pt-2");
  });
});

// ── assetCode filter ──────────────────────────────────────────────────────────

describe("GET /account/:id/payments — assetCode filter", () => {
  it("returns only payments matching the given assetCode (case-insensitive)", async () => {
    server.payments.mockReturnValue(chainResolve([
      makePayment({ asset_code: "USDC", asset_issuer: ISSUER_USDC }),
      makePayment({ id: "op-2", asset_code: "EUR",  asset_issuer: ISSUER_EUR, paging_token: "pt2" }),
    ]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments?assetCode=USDC`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.payments).toHaveLength(1);
    expect(res.body.data.payments[0].asset.code).toBe("USDC");
  });

  it("is case-insensitive for assetCode", async () => {
    server.payments.mockReturnValue(chainResolve([
      makePayment({ asset_code: "USDC" }),
    ]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments?assetCode=usdc`);
    expect(res.body.data.payments).toHaveLength(1);
  });

  it("returns empty when no records match assetCode", async () => {
    server.payments.mockReturnValue(chainResolve([
      makePayment({ asset_code: "USDC" }),
    ]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments?assetCode=XLM`);
    expect(res.body.data.payments).toHaveLength(0);
  });

  it("matches assetCode against sourceAsset on path payments", async () => {
    server.payments.mockReturnValue(chainResolve([
      makePathPaymentStrictSend({
        asset_code: "EUR", asset_issuer: ISSUER_EUR,
        source_asset_code: "USDC", source_asset_issuer: ISSUER_USDC,
      }),
    ]));
    // assetCode=USDC matches the SOURCE asset of this path payment
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments?assetCode=USDC`);
    expect(res.body.data.payments).toHaveLength(1);
  });
});

// ── assetIssuer filter ────────────────────────────────────────────────────────

describe("GET /account/:id/payments — assetIssuer filter", () => {
  it("narrows assetCode match to a specific issuer", async () => {
    server.payments.mockReturnValue(chainResolve([
      makePayment({ asset_code: "USDC", asset_issuer: ISSUER_USDC }),
      makePayment({ id: "op-2", asset_code: "USDC", asset_issuer: ISSUER_EUR, paging_token: "pt2" }),
    ]));
    const res = await request(app).get(
      `/account/${VALID_ACCOUNT}/payments?assetCode=USDC&assetIssuer=${ISSUER_USDC}`
    );
    expect(res.body.data.payments).toHaveLength(1);
    expect(res.body.data.payments[0].asset.issuer).toBe(ISSUER_USDC);
  });

  it("returns empty when issuer does not match any record", async () => {
    server.payments.mockReturnValue(chainResolve([
      makePayment({ asset_code: "USDC", asset_issuer: ISSUER_USDC }),
    ]));
    const res = await request(app).get(
      `/account/${VALID_ACCOUNT}/payments?assetCode=USDC&assetIssuer=${ISSUER_EUR}`
    );
    expect(res.body.data.payments).toHaveLength(0);
  });
});

// ── startDate / endDate filters ───────────────────────────────────────────────

describe("GET /account/:id/payments — startDate / endDate filters", () => {
  it("excludes payments before startDate", async () => {
    server.payments.mockReturnValue(chainResolve([
      makePayment({ created_at: "2024-01-01T00:00:00Z", paging_token: "pt1" }),
      makePayment({ id: "op-2", created_at: "2024-06-01T00:00:00Z", paging_token: "pt2" }),
    ]));
    const res = await request(app).get(
      `/account/${VALID_ACCOUNT}/payments?startDate=2024-03-01T00:00:00Z`
    );
    expect(res.body.data.payments).toHaveLength(1);
    expect(res.body.data.payments[0].createdAt).toContain("2024-06");
  });

  it("excludes payments after endDate", async () => {
    server.payments.mockReturnValue(chainResolve([
      makePayment({ created_at: "2024-01-01T00:00:00Z", paging_token: "pt1" }),
      makePayment({ id: "op-2", created_at: "2024-06-01T00:00:00Z", paging_token: "pt2" }),
    ]));
    const res = await request(app).get(
      `/account/${VALID_ACCOUNT}/payments?endDate=2024-03-01T00:00:00Z`
    );
    expect(res.body.data.payments).toHaveLength(1);
    expect(res.body.data.payments[0].createdAt).toContain("2024-01");
  });

  it("returns payments within startDate–endDate window", async () => {
    server.payments.mockReturnValue(chainResolve([
      makePayment({ created_at: "2024-01-01T00:00:00Z", paging_token: "pt1" }),
      makePayment({ id: "op-2", created_at: "2024-04-01T00:00:00Z", paging_token: "pt2" }),
      makePayment({ id: "op-3", created_at: "2024-08-01T00:00:00Z", paging_token: "pt3" }),
    ]));
    const res = await request(app).get(
      `/account/${VALID_ACCOUNT}/payments?startDate=2024-02-01T00:00:00Z&endDate=2024-06-01T00:00:00Z`
    );
    expect(res.body.data.payments).toHaveLength(1);
    expect(res.body.data.payments[0].id).toBeUndefined(); // paymentId, not id
    expect(res.body.data.payments[0].createdAt).toContain("2024-04");
  });

  it("returns 400 when startDate is after endDate", async () => {
    server.payments.mockReturnValue(chainResolve([]));
    const res = await request(app).get(
      `/account/${VALID_ACCOUNT}/payments?startDate=2024-12-01T00:00:00Z&endDate=2024-01-01T00:00:00Z`
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("GET /account/:id/payments — error handling", () => {
  it("returns 404 with type 'AccountNotFound' when Horizon returns 404", async () => {
    server.payments.mockReturnValue(chainReject({ response: { status: 404 } }));

    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  it("returns 400 for an invalid account ID", async () => {
    const res = await request(app).get("/account/INVALID/payments");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
  });

  it("returns 200 with empty payments array for account with no payments", async () => {
    server.payments.mockReturnValue(chainResolve([]));
    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.payments).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });
});
