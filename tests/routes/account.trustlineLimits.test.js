/**
 * tests/routes/account.trustlineLimits.test.js
 *
 * Unit tests for GET /account/:id/trustline-limits
 *
 *   1. Trustline at 95% capacity returns nearLimit: true.
 *   2. Trustline at 50% capacity returns nearLimit: false.
 *   3. usedPercent is computed correctly as (balance / limit) * 100.
 *   4. Trustline with zero limit returns usedPercent: 0.
 *   5. Account with no trustlines returns an empty array.
 *
 * server.loadAccount() is mocked with controlled balance and limit values.
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      loadAccount: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();

function makeTrustline(code, balance, limit) {
  return {
    asset_type: code.length > 4 ? "credit_alphanum12" : "credit_alphanum4",
    asset_code: code,
    asset_issuer: ISSUER,
    balance: String(balance),
    limit: String(limit),
    is_authorized: true,
  };
}

const nativeBalance = { asset_type: "native", balance: "10.0000000" };

describe("GET /account/:id/trustline-limits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("trustline at 95% capacity returns nearLimit: true", async () => {
    server.loadAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      balances: [nativeBalance, makeTrustline("USDC", "950.0000000", "1000.0000000")],
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/trustline-limits`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const tl = res.body.data.trustlines[0];
    expect(tl.nearLimit).toBe(true);
    expect(tl.usedPercent).toBeCloseTo(95, 1);
  });

  it("trustline at 50% capacity returns nearLimit: false", async () => {
    server.loadAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      balances: [nativeBalance, makeTrustline("USDC", "500.0000000", "1000.0000000")],
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/trustline-limits`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const tl = res.body.data.trustlines[0];
    expect(tl.nearLimit).toBe(false);
    expect(tl.usedPercent).toBeCloseTo(50, 1);
  });

  it("usedPercent is computed correctly as (balance / limit) * 100", async () => {
    server.loadAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      balances: [makeTrustline("EURT", "250.0000000", "1000.0000000")],
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/trustline-limits`);

    expect(res.status).toBe(200);
    const tl = res.body.data.trustlines[0];
    expect(tl.usedPercent).toBeCloseTo(25, 1);
  });

  it("trustline with zero limit returns usedPercent: 0", async () => {
    server.loadAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      balances: [makeTrustline("NOVA", "0.0000000", "0.0000000")],
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/trustline-limits`);

    expect(res.status).toBe(200);
    const tl = res.body.data.trustlines[0];
    expect(tl.usedPercent).toBe(0);
    expect(tl.nearLimit).toBe(false);
  });

  it("account with no trustlines returns an empty array", async () => {
    server.loadAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      balances: [nativeBalance],
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/trustline-limits`);

    expect(res.status).toBe(200);
    expect(res.body.data.trustlines).toEqual([]);
  });
});
