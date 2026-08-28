"use strict";

/**
 * Tests for POST /account/freeze-status (bulk freeze-status check).
 *
 * Covers:
 *   - Authorized accounts return status "authorized"
 *   - Fully frozen accounts return status "frozen"
 *   - Partially frozen (maintain-liabilities) accounts return status "frozen_maintain_liabilities"
 *   - Non-existent accounts return an error entry (not a 400/500)
 *   - Accounts that do not hold the asset return an error entry
 *   - Exceeding 20 addresses returns 400
 *   - Missing / invalid body fields return 400
 *   - Mixed results (authorized + frozen + error) in one response
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: { loadAccount: jest.fn() },
  NETWORK: "testnet",
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const issuer = Keypair.random().publicKey();
const addrAuthorized = Keypair.random().publicKey();
const addrFrozen = Keypair.random().publicKey();
const addrMaintain = Keypair.random().publicKey();
const addrNoTrustline = Keypair.random().publicKey();

const ASSET = { code: "USDC", issuer };

function makeAccount(address, opts = {}) {
  const {
    hasTrustline = true,
    isAuthorized = true,
    isAuthorizedToMaintainLiabilities = true,
  } = opts;

  const balances = [{ asset_type: "native", balance: "100.0000000" }];

  if (hasTrustline) {
    balances.push({
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: issuer,
      balance: "10.0000000",
      is_authorized: isAuthorized,
      is_authorized_to_maintain_liabilities: isAuthorizedToMaintainLiabilities,
    });
  }

  return { id: address, balances };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNotFoundError() {
  const err = new Error("Not found");
  err.response = { status: 404 };
  return err;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("POST /account/freeze-status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Authorized account ─────────────────────────────────────────────────────

  it("returns authorized status for a fully authorized trustline", async () => {
    server.loadAccount.mockResolvedValueOnce(
      makeAccount(addrAuthorized, { isAuthorized: true, isAuthorizedToMaintainLiabilities: true })
    );

    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses: [addrAuthorized], asset: ASSET });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.results[addrAuthorized].status).toBe("authorized");
    expect(res.body.data.results[addrAuthorized].isAuthorized).toBe(true);
    expect(res.body.data.results[addrAuthorized].isAuthorizedToMaintainLiabilities).toBe(true);
  });

  // ── Frozen account ─────────────────────────────────────────────────────────

  it("returns frozen status when authorization is fully revoked", async () => {
    server.loadAccount.mockResolvedValueOnce(
      makeAccount(addrFrozen, { isAuthorized: false, isAuthorizedToMaintainLiabilities: false })
    );

    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses: [addrFrozen], asset: ASSET });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.results[addrFrozen].status).toBe("frozen");
    expect(res.body.data.results[addrFrozen].isAuthorized).toBe(false);
    expect(res.body.data.results[addrFrozen].isAuthorizedToMaintainLiabilities).toBe(false);
  });

  // ── Partially frozen (maintain liabilities) ────────────────────────────────

  it("returns frozen_maintain_liabilities when only liabilities are authorized", async () => {
    server.loadAccount.mockResolvedValueOnce(
      makeAccount(addrMaintain, { isAuthorized: false, isAuthorizedToMaintainLiabilities: true })
    );

    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses: [addrMaintain], asset: ASSET });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.results[addrMaintain].status).toBe("frozen_maintain_liabilities");
    expect(res.body.data.results[addrMaintain].isAuthorized).toBe(false);
    expect(res.body.data.results[addrMaintain].isAuthorizedToMaintainLiabilities).toBe(true);
  });

  // ── Non-existent account ───────────────────────────────────────────────────

  it("returns an error entry for a non-existent account (Horizon 404)", async () => {
    server.loadAccount.mockRejectedValueOnce(makeNotFoundError());

    const nonExistent = Keypair.random().publicKey();
    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses: [nonExistent], asset: ASSET });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.results[nonExistent].status).toBe("error");
    expect(typeof res.body.data.results[nonExistent].error).toBe("string");
    expect(res.body.data.results[nonExistent].isAuthorized).toBeNull();
  });

  // ── Account without the trustline ─────────────────────────────────────────

  it("returns an error entry when account does not hold the asset", async () => {
    server.loadAccount.mockResolvedValueOnce(
      makeAccount(addrNoTrustline, { hasTrustline: false })
    );

    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses: [addrNoTrustline], asset: ASSET });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.results[addrNoTrustline].status).toBe("error");
    expect(res.body.data.results[addrNoTrustline].error).toMatch(/does not hold asset/i);
    expect(res.body.data.results[addrNoTrustline].isAuthorized).toBeNull();
  });

  // ── Mixed results ──────────────────────────────────────────────────────────

  it("handles a mixed batch of authorized, frozen, and non-existent accounts", async () => {
    server.loadAccount
      .mockResolvedValueOnce(makeAccount(addrAuthorized))
      .mockResolvedValueOnce(makeAccount(addrFrozen, { isAuthorized: false, isAuthorizedToMaintainLiabilities: false }))
      .mockRejectedValueOnce(makeNotFoundError());

    const nonExistent = Keypair.random().publicKey();
    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses: [addrAuthorized, addrFrozen, nonExistent], asset: ASSET });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.results[addrAuthorized].status).toBe("authorized");
    expect(res.body.data.results[addrFrozen].status).toBe("frozen");
    expect(res.body.data.results[nonExistent].status).toBe("error");
  });

  // ── Validation: too many addresses ────────────────────────────────────────

  it("returns 400 when more than 20 addresses are supplied", async () => {
    const addresses = Array.from({ length: 21 }, () => Keypair.random().publicKey());

    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses, asset: ASSET });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── Validation: exactly 20 addresses is fine ──────────────────────────────

  it("accepts exactly 20 addresses without error", async () => {
    const addresses = Array.from({ length: 20 }, () => Keypair.random().publicKey());
    // All return the same authorized account shape
    server.loadAccount.mockImplementation((addr) =>
      Promise.resolve(makeAccount(addr))
    );

    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses, asset: ASSET });

    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body.data.results)).toHaveLength(20);
  });

  // ── Validation: missing addresses ─────────────────────────────────────────

  it("returns 400 when addresses field is missing", async () => {
    const res = await request(app)
      .post("/account/freeze-status")
      .send({ asset: ASSET });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when addresses is not an array", async () => {
    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses: addrAuthorized, asset: ASSET });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── Validation: missing asset ──────────────────────────────────────────────

  it("returns 400 when asset field is missing", async () => {
    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses: [addrAuthorized] });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when asset.code is missing", async () => {
    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses: [addrAuthorized], asset: { issuer } });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when asset.issuer is missing", async () => {
    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses: [addrAuthorized], asset: { code: "USDC" } });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── Validation: invalid address format ────────────────────────────────────

  it("returns 400 when an address in the array is not a valid Stellar public key", async () => {
    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses: ["NOT_A_VALID_KEY"], asset: ASSET });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── Response shape ─────────────────────────────────────────────────────────

  it("always returns success:true and data.results object on a valid request", async () => {
    server.loadAccount.mockResolvedValueOnce(makeAccount(addrAuthorized));

    const res = await request(app)
      .post("/account/freeze-status")
      .send({ addresses: [addrAuthorized], asset: ASSET });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("results");
    expect(typeof res.body.data.results).toBe("object");
  });
});
