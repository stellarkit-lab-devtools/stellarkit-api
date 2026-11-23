/**
 * tests/routes/utils.simulatePayment.test.js
 *
 * Unit tests for POST /utils/simulate-payment
 *
 *   1. Valid payment with sufficient balance       → canSend: true.
 *   2. Insufficient sender balance                 → canSend: false + balance warning.
 *   3. Recipient without a trustline for the asset → canSend: false + trustline warning.
 *   4. Invalid sender address                      → HTTP 400.
 *
 * server.loadAccount() is mocked to control balances and trustlines.
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

const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();
const USDC_ISSUER = Keypair.random().publicKey();

const native = (balance) => ({ asset_type: "native", balance, selling_liabilities: "0.0000000" });
const usdc = (balance) => ({
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: USDC_ISSUER,
  balance,
  selling_liabilities: "0.0000000",
  is_authorized: true,
});

function mockAccounts(map) {
  server.loadAccount.mockImplementation(async (id) => {
    if (!map[id]) {
      const err = new Error("Not Found");
      err.response = { status: 404 };
      throw err;
    }
    return { id, subentry_count: 0, ...map[id] };
  });
}

describe("POST /utils/simulate-payment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns canSend: true for a valid payment with sufficient balance", async () => {
    mockAccounts({
      [SENDER]: { balances: [native("100.0000000"), usdc("500.0000000")] },
      [RECIPIENT]: { balances: [native("10.0000000"), usdc("0.0000000")] },
    });

    const res = await request(app).post("/utils/simulate-payment").send({
      source: SENDER,
      destination: RECIPIENT,
      amount: "50",
      assetCode: "USDC",
      assetIssuer: USDC_ISSUER,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.canSend).toBe(true);
    expect(res.body.data.warnings).toEqual([]);
  });

  it("returns canSend: false with a balance warning when the sender balance is insufficient", async () => {
    mockAccounts({
      [SENDER]: { balances: [native("5.0000000")] },
      [RECIPIENT]: { balances: [native("10.0000000")] },
    });

    const res = await request(app).post("/utils/simulate-payment").send({
      source: SENDER,
      destination: RECIPIENT,
      amount: "100",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.canSend).toBe(false);
    const types = res.body.data.warnings.map((w) => w.type);
    expect(types).toContain("balance");
    expect(types).not.toContain("trustline");
  });

  it("returns canSend: false with a trustline warning when the recipient has no trustline", async () => {
    mockAccounts({
      [SENDER]: { balances: [native("100.0000000"), usdc("500.0000000")] },
      [RECIPIENT]: { balances: [native("10.0000000")] },
    });

    const res = await request(app).post("/utils/simulate-payment").send({
      source: SENDER,
      destination: RECIPIENT,
      amount: "50",
      assetCode: "USDC",
      assetIssuer: USDC_ISSUER,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.canSend).toBe(false);
    const types = res.body.data.warnings.map((w) => w.type);
    expect(types).toContain("trustline");
    expect(types).not.toContain("balance");
  });

  it("returns 400 for an invalid sender address", async () => {
    const res = await request(app).post("/utils/simulate-payment").send({
      source: "NOT_A_VALID_ADDRESS",
      destination: RECIPIENT,
      amount: "10",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(server.loadAccount).not.toHaveBeenCalled();
  });
});
