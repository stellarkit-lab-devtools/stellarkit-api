/**
 * Tests for AccountNotFound (404) error handling across all endpoints
 * that accept an account ID. Verifies the structured error response shape
 * returned when Horizon reports a missing account.
 */
const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const app = require("../src/index");
const { server, fetchAccountCreation } = require("../src/config/stellar");

// Generate a cryptographically valid (but unfunded) account ID for each run
const VALID_ID = Keypair.random().publicKey();
const ISSUER_ID = Keypair.random().publicKey();
const HORIZON_404 = { response: { status: 404 } };

const EXPECTED_SUGGESTION =
  "Verify the account address is correct and that the account has been funded.";

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      loadAccount: jest.fn(),
      transactions: jest.fn(),
      operations: jest.fn(),
      offers: jest.fn(),
      payments: jest.fn(),
      accounts: jest.fn(),
    },
    fetchAccountCreation: jest.fn(),
  };
});

function expectAccountNotFound(body, accountId) {
  expect(body.success).toBe(false);
  expect(body.error.type).toBe("AccountNotFound");
  expect(body.error.message).toContain(accountId);
  expect(body.error.suggestion).toBe(EXPECTED_SUGGESTION);
}

// Build a chainable Horizon builder that rejects with a 404 at .call()
function chain404() {
  const obj = {
    forAccount: () => chain404(),
    limit: () => chain404(),
    order: () => chain404(),
    cursor: () => chain404(),
    includeFailed: () => chain404(),
    call: jest.fn().mockRejectedValue(HORIZON_404),
  };
  return obj;
}

beforeEach(() => {
  jest.clearAllMocks();
  server.transactions.mockReturnValue(chain404());
  server.operations.mockReturnValue(chain404());
  server.offers.mockReturnValue(chain404());
  server.payments.mockReturnValue(chain404());
  server.accounts.mockReturnValue({
    sponsor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: [] }),
  });
});

// ── /account/:id ──────────────────────────────────────────────────────────────

describe("GET /account/:id", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);
    const res = await request(app).get(`/account/${VALID_ID}`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/trustlines ───────────────────────────────────────────────────

describe("GET /account/:id/trustlines", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);
    const res = await request(app).get(`/account/${VALID_ID}/trustlines`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/balances ─────────────────────────────────────────────────────

describe("GET /account/:id/balances", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);
    const res = await request(app).get(`/account/${VALID_ID}/balances`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/sequence ─────────────────────────────────────────────────────

describe("GET /account/:id/sequence", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);
    const res = await request(app).get(`/account/${VALID_ID}/sequence`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/payments ─────────────────────────────────────────────────────

describe("GET /account/:id/payments", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    const res = await request(app).get(`/account/${VALID_ID}/payments`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/offers ───────────────────────────────────────────────────────

describe("GET /account/:id/offers", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    const res = await request(app).get(`/account/${VALID_ID}/offers`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/analytics ───────────────────────────────────────────────────

describe("GET /account/:id/analytics", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    const res = await request(app).get(`/account/${VALID_ID}/analytics`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/subentry-health ─────────────────────────────────────────────

describe("GET /account/:id/subentry-health", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);
    const res = await request(app).get(`/account/${VALID_ID}/subentry-health`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/sponsorship ──────────────────────────────────────────────────

describe("GET /account/:id/sponsorship", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);
    const res = await request(app).get(`/account/${VALID_ID}/sponsorship`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/freeze-status/:assetCode/:assetIssuer ───────────────────────

describe("GET /account/:id/freeze-status/:assetCode/:assetIssuer", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);
    const res = await request(app).get(
      `/account/${VALID_ID}/freeze-status/USDC/${ISSUER_ID}`
    );
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/age ─────────────────────────────────────────────────────────

describe("GET /account/:id/age", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    fetchAccountCreation.mockRejectedValue(HORIZON_404);
    const res = await request(app).get(`/account/${VALID_ID}/age`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/inactivity ───────────────────────────────────────────────────

describe("GET /account/:id/inactivity", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    const res = await request(app).get(`/account/${VALID_ID}/inactivity`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/can-receive/:assetCode/:assetIssuer ────────────────────────

describe("GET /account/:id/can-receive/:assetCode/:assetIssuer", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);
    const res = await request(app).get(
      `/account/${VALID_ID}/can-receive/USDC/${ISSUER_ID}`
    );
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/volume ───────────────────────────────────────────────────────

describe("GET /account/:id/volume", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    const res = await request(app).get(`/account/${VALID_ID}/volume`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/offer-history ────────────────────────────────────────────────

describe("GET /account/:id/offer-history", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    const res = await request(app).get(`/account/${VALID_ID}/offer-history`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/pool-positions ──────────────────────────────────────────────

describe("GET /account/:id/pool-positions", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);
    const res = await request(app).get(`/account/${VALID_ID}/pool-positions`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/multisig-plan ────────────────────────────────────────────────

describe("POST /account/:id/multisig-plan", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);
    const res = await request(app)
      .post(`/account/${VALID_ID}/multisig-plan`)
      .send({ availableSigners: [VALID_ID] });
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /account/:id/counterparties ───────────────────────────────────────────────

describe("GET /account/:id/counterparties", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);
    const res = await request(app).get(`/account/${VALID_ID}/counterparties`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /transactions/:id ─────────────────────────────────────────────────────────

describe("GET /transactions/:id", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    const res = await request(app).get(`/transactions/${VALID_ID}`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── /transactions/:id/operations ─────────────────────────────────────────────

describe("GET /transactions/:id/operations", () => {
  it("returns AccountNotFound when account does not exist", async () => {
    const res = await request(app).get(`/transactions/${VALID_ID}/operations`);
    expect(res.statusCode).toBe(404);
    expectAccountNotFound(res.body, VALID_ID);
  });
});

// ── error shape completeness ──────────────────────────────────────────────────

describe("AccountNotFound error shape", () => {
  it("includes type, message with account ID and network, and suggestion", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);
    const res = await request(app).get(`/account/${VALID_ID}/balances`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatchObject({
      type: "AccountNotFound",
      message: expect.stringContaining(VALID_ID),
      suggestion: EXPECTED_SUGGESTION,
    });
    expect(res.body.error.message).toMatch(/testnet|mainnet/);
  });
});
