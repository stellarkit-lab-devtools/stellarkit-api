/**
 * Tests for GET /account/:id/signer-changes.
 */
const request = require("supertest");
const express = require("express");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => ({
  ...jest.requireActual("../../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
    effects: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use("/account", require("../../src/routes/account"));
app.use(require("../../src/middleware/errorHandler"));

const { server } = require("../../src/config/stellar");
const ACCOUNT = Keypair.random().publicKey();
const SIGNER = Keypair.random().publicKey();
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const applied = {};
function mockEffects(records) {
  const chain = {
    limit: jest.fn((v) => { applied.limit = v; return chain; }),
    order: jest.fn((v) => { applied.order = v; return chain; }),
    cursor: jest.fn((v) => { applied.cursor = v; return chain; }),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.effects.mockReturnValue({ forAccount: jest.fn((id) => { applied.account = id; return chain; }) });
}

function effect(type, overrides = {}) {
  return {
    type,
    created_at: daysAgo(1),
    ledger_sequence: 12345,
    transaction_hash: "abc123",
    public_key: SIGNER,
    weight: 3,
    ...overrides,
  };
}

describe("GET /account/:id/signer-changes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(applied).forEach((k) => delete applied[k]);
    server.loadAccount.mockResolvedValue({
      id: ACCOUNT,
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
    });
    mockEffects([]);
  });

  it("flags a newly added signer that can control the account alone", async () => {
    mockEffects([effect("signer_created", { weight: 3 })]);
    const res = await request(app).get(`/account/${ACCOUNT}/signer-changes`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      accountId: ACCOUNT,
      total: 1,
      changes: [{
        type: "signer_created",
        signerKey: SIGNER,
        weight: 3,
        thresholds: { low: 1, med: 2, high: 2 },
        controlCapable: true,
        ledger: 12345,
        transactionHash: "abc123",
      }],
    });
    expect(res.body.data.changes[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does not flag a low-weight new signer", async () => {
    mockEffects([effect("signer_created", { weight: 1 })]);
    const res = await request(app).get(`/account/${ACCOUNT}/signer-changes`);
    expect(res.body.data.changes[0].controlCapable).toBe(false);
  });

  it("maps removed, updated and threshold effects", async () => {
    mockEffects([
      effect("signer_removed", { weight: 1 }),
      effect("signer_updated", { weight: 2 }),
      effect("account_thresholds_updated", {
        public_key: undefined,
        weight: undefined,
        low_threshold: 1,
        med_threshold: 3,
        high_threshold: 3,
      }),
    ]);
    const res = await request(app).get(`/account/${ACCOUNT}/signer-changes`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.changes.map((c) => c.type)).toEqual([
      "signer_removed", "signer_updated", "thresholds_updated",
    ]);
    expect(res.body.data.changes[2].thresholds).toEqual({ low: 1, med: 3, high: 3 });
    expect(res.body.data.changes.every((c) => c.controlCapable === false)).toBe(true);
  });

  it("defaults to 30 days and honours the days filter", async () => {
    mockEffects([
      effect("signer_created", { created_at: daysAgo(5) }),
      effect("signer_created", { created_at: daysAgo(40) }),
    ]);
    const recent = await request(app).get(`/account/${ACCOUNT}/signer-changes`);
    expect(recent.body.data.total).toBe(1);
    const wider = await request(app).get(`/account/${ACCOUNT}/signer-changes?days=60`);
    expect(wider.body.data.total).toBe(2);
  });

  it("caps days at 365", async () => {
    mockEffects([effect("signer_created", { created_at: daysAgo(300) })]);
    const res = await request(app).get(`/account/${ACCOUNT}/signer-changes?days=1000`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.total).toBe(1);
  });

  it("returns an empty list for an account with no changes", async () => {
    const res = await request(app).get(`/account/${ACCOUNT}/signer-changes`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ accountId: ACCOUNT, changes: [], total: 0 });
  });

  it("uses standard pagination", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT}/signer-changes?limit=5&order=asc&cursor=99`,
    );
    expect(res.statusCode).toBe(200);
    expect(applied).toMatchObject({ limit: 5, order: "asc", cursor: "99", account: ACCOUNT });
  });

  it("returns 404 for an unknown account", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });
    const res = await request(app).get(`/account/${ACCOUNT}/signer-changes`);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.type).toBe("AccountNotFound");
  });
});
