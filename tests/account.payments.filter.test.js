"use strict";

/**
 * Tests for GET /account/:id/payments — asset filter params
 *
 * Updated to use the correct server.payments() data source and response shape.
 */
const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
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
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");

const accountId   = Keypair.random().publicKey();
const USDC_ISSUER  = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OTHER_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const mockPaymentRecords = [
  {
    id: "op-1",
    type: "payment",
    asset_code: "USDC",
    asset_issuer: USDC_ISSUER,
    asset_type: "credit_alphanum4",
    amount: "10.0000000",
    from: accountId,
    to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    created_at: "2024-01-01T00:00:00Z",
    transaction_hash: "hash1",
    paging_token: "t1",
  },
  {
    id: "op-2",
    type: "payment",
    asset_code: "USDC",
    asset_issuer: OTHER_ISSUER,
    asset_type: "credit_alphanum4",
    amount: "5.0000000",
    from: accountId,
    to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    created_at: "2024-01-02T00:00:00Z",
    transaction_hash: "hash2",
    paging_token: "t2",
  },
  {
    id: "op-3",
    type: "payment",
    asset_type: "native",
    amount: "100.0000000",
    from: accountId,
    to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    created_at: "2024-01-03T00:00:00Z",
    transaction_hash: "hash3",
    paging_token: "t3",
  },
];

function mockPayments(records) {
  server.payments.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit:      jest.fn().mockReturnThis(),
    order:      jest.fn().mockReturnThis(),
    cursor:     jest.fn().mockReturnThis(),
    call:       jest.fn().mockResolvedValue({ records }),
  });
}

beforeEach(() => jest.clearAllMocks());

describe("GET /account/:id/payments — asset filters", () => {
  it("returns all payments when no filter is provided", async () => {
    mockPayments(mockPaymentRecords);
    const res = await request(app).get(`/account/${accountId}/payments`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.payments).toHaveLength(3);
  });

  it("filters by assetCode alone — returns all issuers of that code", async () => {
    mockPayments(mockPaymentRecords);
    const res = await request(app).get(`/account/${accountId}/payments?assetCode=USDC`);
    expect(res.statusCode).toBe(200);
    const { payments } = res.body.data;
    expect(payments).toHaveLength(2);
    payments.forEach((p) => expect(p.asset.code).toBe("USDC"));
  });

  it("assetCode filter is case-insensitive", async () => {
    mockPayments(mockPaymentRecords);
    const res = await request(app).get(`/account/${accountId}/payments?assetCode=usdc`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.payments).toHaveLength(2);
  });

  it("filters by assetCode + assetIssuer — exact match only", async () => {
    mockPayments(mockPaymentRecords);
    const res = await request(app).get(
      `/account/${accountId}/payments?assetCode=USDC&assetIssuer=${USDC_ISSUER}`
    );
    expect(res.statusCode).toBe(200);
    const { payments } = res.body.data;
    expect(payments).toHaveLength(1);
    expect(payments[0].asset.issuer).toBe(USDC_ISSUER);
  });

  it("returns empty array (not 404) when no payments match the filter", async () => {
    mockPayments(mockPaymentRecords);
    const res = await request(app).get(`/account/${accountId}/payments?assetCode=BTC`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.payments).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });

  it("assetIssuer alone without assetCode has no effect — all payments returned", async () => {
    mockPayments(mockPaymentRecords);
    const res = await request(app).get(
      `/account/${accountId}/payments?assetIssuer=${USDC_ISSUER}`
    );
    expect(res.statusCode).toBe(200);
    // issuer-only filter is ignored per spec
    expect(res.body.data.payments).toHaveLength(3);
  });
});
