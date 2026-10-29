/**
 * Tests for GET /account/:id/sep10-challenge
 *
 * The endpoint generates a SEP-10 Web Authentication challenge XDR for the
 * given Stellar account. Each challenge:
 *   - Expires exactly 15 minutes from request time (±2 s tolerance)
 *   - Embeds the configured STELLAR_NETWORK env var in the `network` field
 *   - Returns a valid base64 string in `challengeXdr`
 *   - Is unique across sequential requests (random nonce)
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

// ── Mock stellar config so no live Horizon calls are made ──────────────────
jest.mock("../../src/config/stellar", () => {
  const originalModule = jest.requireActual("../../src/config/stellar");
  return {
    ...originalModule,
    server: { loadAccount: jest.fn() },
    NETWORK: "testnet",
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

// A valid Stellar public key to use as the account under test
const ACCOUNT_ID = Keypair.random().publicKey();

function mockAccountExists() {
  server.loadAccount.mockResolvedValue({
    id: ACCOUNT_ID,
    sequence: "1",
    subentry_count: 0,
    balances: [{ asset_type: "native", balance: "100.0000000", buying_liabilities: "0", selling_liabilities: "0" }],
    signers: [{ key: ACCOUNT_ID, weight: 1, type: "ed25519_public_key" }],
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: {},
    home_domain: null,
    last_modified_ledger: 1,
  });
}

function mockAccountNotFound() {
  const err = new Error("Not Found");
  err.response = { status: 404 };
  server.loadAccount.mockRejectedValue(err);
}

const BASE_URL = `/account/${ACCOUNT_ID}/sep10-challenge`;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

describe("GET /account/:id/sep10-challenge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // ── 1. expiresAt is exactly 15 minutes from request time ─────────────────
  it("returns expiresAt exactly 15 minutes from request time (within 2 s tolerance)", async () => {
    mockAccountExists();

    const before = Date.now();
    const res = await request(app).get(BASE_URL);
    const after = Date.now();

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const expiresAt = new Date(res.body.data.expiresAt).getTime();

    // Lower bound: before + 15 min - 2 s
    expect(expiresAt).toBeGreaterThanOrEqual(before + FIFTEEN_MINUTES_MS - 2000);
    // Upper bound: after + 15 min + 2 s
    expect(expiresAt).toBeLessThanOrEqual(after + FIFTEEN_MINUTES_MS + 2000);
  });

  // ── 2. network field matches STELLAR_NETWORK env var ─────────────────────
  it("returns network field matching the STELLAR_NETWORK env var", async () => {
    mockAccountExists();

    const originalNetwork = process.env.STELLAR_NETWORK;
    process.env.STELLAR_NETWORK = "testnet";

    const res = await request(app).get(BASE_URL);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.network).toBe("testnet");

    process.env.STELLAR_NETWORK = originalNetwork;
  });

  it("returns network: mainnet when STELLAR_NETWORK is mainnet", async () => {
    mockAccountExists();

    const originalNetwork = process.env.STELLAR_NETWORK;
    process.env.STELLAR_NETWORK = "mainnet";

    const res = await request(app).get(BASE_URL);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.network).toBe("mainnet");

    process.env.STELLAR_NETWORK = originalNetwork;
  });

  // ── 3. challengeXdr decodes to a valid base64 string ─────────────────────
  it("returns challengeXdr as a valid base64 string", async () => {
    mockAccountExists();

    const res = await request(app).get(BASE_URL);

    expect(res.statusCode).toBe(200);

    const { challengeXdr } = res.body.data;
    expect(typeof challengeXdr).toBe("string");
    expect(challengeXdr.length).toBeGreaterThan(0);

    // Valid base64 pattern: only A-Z, a-z, 0-9, +, /, = characters
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    expect(base64Regex.test(challengeXdr)).toBe(true);

    // Must round-trip through Buffer without error
    expect(() => {
      const decoded = Buffer.from(challengeXdr, "base64");
      expect(decoded.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  // ── 4. Two sequential requests produce different challengeXDRs ────────────
  it("generates a different challengeXdr on each request, confirming uniqueness", async () => {
    mockAccountExists();

    const res1 = await request(app).get(BASE_URL);
    const res2 = await request(app).get(BASE_URL);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const xdr1 = res1.body.data.challengeXdr;
    const xdr2 = res2.body.data.challengeXdr;

    expect(typeof xdr1).toBe("string");
    expect(typeof xdr2).toBe("string");
    expect(xdr1).not.toBe(xdr2);
  });

  // ── Response shape ────────────────────────────────────────────────────────
  it("returns correct response shape with all required fields", async () => {
    mockAccountExists();

    const res = await request(app).get(BASE_URL);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      accountId: ACCOUNT_ID,
      challengeXdr: expect.any(String),
      expiresAt: expect.any(String),
      network: expect.any(String),
    });
  });

  it("returns expiresAt as a valid ISO 8601 string", async () => {
    mockAccountExists();

    const res = await request(app).get(BASE_URL);

    expect(res.statusCode).toBe(200);

    const { expiresAt } = res.body.data;
    const parsed = new Date(expiresAt);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    // ISO 8601 — ends with Z or +HH:MM
    expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // ── Error paths ───────────────────────────────────────────────────────────
  it("returns 404 when the account does not exist", async () => {
    mockAccountNotFound();

    const res = await request(app).get(BASE_URL);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  it("returns 400 for an invalid account ID", async () => {
    const res = await request(app).get("/account/BADKEY/sep10-challenge");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
    expect(server.loadAccount).not.toHaveBeenCalled();
  });
});
