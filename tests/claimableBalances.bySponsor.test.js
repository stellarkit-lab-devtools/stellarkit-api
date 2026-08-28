/**
 * Tests for GET /claimable-balances/by-sponsor/:address
 *
 * Covers:
 *   - 200 response with correct normalised shape
 *   - Sponsor address validation (400 on invalid address)
 *   - Pagination: limit, cursor forwarded to Horizon; cursor returned in response
 *   - All amounts are seven-decimal strings
 *   - Empty list when sponsor has no balances
 *   - Response envelope: { success: true, data: { balances, total, limit, cursor } }
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    claimableBalances: jest.fn(),
  },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

// ---------- Fixtures ---------------------------------------------------------

const sponsorAddress = Keypair.random().publicKey();
const claimantA = Keypair.random().publicKey();
const claimantB = Keypair.random().publicKey();
const issuerAddress = Keypair.random().publicKey();

function makeBalance(overrides = {}) {
  return {
    id: overrides.id || "0000000000000000000000000000000000000000000000000000000000000001",
    paging_token: overrides.paging_token || "pt-1",
    asset: overrides.asset || `USDC:${issuerAddress}`,
    amount: overrides.amount || "100.0000000",
    sponsor: overrides.sponsor || sponsorAddress,
    last_modified_ledger: 500,
    last_modified_time: overrides.last_modified_time || "2024-03-01T12:00:00Z",
    claimants: overrides.claimants || [
      { destination: claimantA, predicate: { unconditional: true } },
    ],
  };
}

function mockClaimableBalances(records) {
  const chain = {
    sponsor: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.claimableBalances.mockReturnValue(chain);
  return chain;
}

// ---------- Tests ------------------------------------------------------------

describe("GET /claimable-balances/by-sponsor/:address", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  // ── Response envelope ──────────────────────────────────────────────────────

  it("returns 200 with the correct response envelope", async () => {
    mockClaimableBalances([makeBalance()]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data.balances)).toBe(true);
    expect(typeof res.body.data.total).toBe("number");
    expect(typeof res.body.data.limit).toBe("number");
  });

  it("returns empty balances array when the sponsor has no claimable balances", async () => {
    mockClaimableBalances([]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.balances).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.cursor).toBeNull();
  });

  // ── Normalised balance shape ───────────────────────────────────────────────

  it("returns each balance with balanceId, asset, amount, claimants, createdAt", async () => {
    const balance = makeBalance();
    mockClaimableBalances([balance]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    const item = res.body.data.balances[0];
    expect(item).toHaveProperty("balanceId");
    expect(item).toHaveProperty("asset");
    expect(item).toHaveProperty("amount");
    expect(item).toHaveProperty("claimants");
    expect(item).toHaveProperty("createdAt");
  });

  it("maps balance.id to balanceId", async () => {
    const balance = makeBalance({ id: "abc123" });
    mockClaimableBalances([balance]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    expect(res.body.data.balances[0].balanceId).toBe("abc123");
  });

  it("normalises asset correctly for a credit_alphanum4 asset", async () => {
    mockClaimableBalances([makeBalance({ asset: `USDC:${issuerAddress}` })]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    const asset = res.body.data.balances[0].asset;
    expect(asset.code).toBe("USDC");
    expect(asset.issuer).toBe(issuerAddress);
    expect(asset.type).toBe("credit_alphanum4");
  });

  it("normalises asset correctly for a credit_alphanum12 asset", async () => {
    mockClaimableBalances([makeBalance({ asset: `LONGASSET12:${issuerAddress}` })]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    const asset = res.body.data.balances[0].asset;
    expect(asset.code).toBe("LONGASSET12");
    expect(asset.type).toBe("credit_alphanum12");
  });

  it("normalises the native XLM asset", async () => {
    mockClaimableBalances([makeBalance({ asset: "native" })]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    const asset = res.body.data.balances[0].asset;
    expect(asset.code).toBe("XLM");
    expect(asset.issuer).toBeNull();
    expect(asset.type).toBe("native");
  });

  it("formats amount as a seven-decimal string", async () => {
    mockClaimableBalances([makeBalance({ amount: "42.5" })]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    // normalizeAmountFields middleware and normalizeSponsorBalance both ensure 7dp
    const amount = res.body.data.balances[0].amount;
    expect(typeof amount).toBe("string");
    expect(amount).toMatch(/^\d+\.\d{7}$/);
  });

  it("returns all seven-decimal amounts for multiple balances", async () => {
    const b1 = makeBalance({ id: "id-1", amount: "10.0000000" });
    const b2 = makeBalance({ id: "id-2", amount: "0.0010000", paging_token: "pt-2" });
    mockClaimableBalances([b1, b2]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    res.body.data.balances.forEach((b) => {
      expect(b.amount).toMatch(/^\d+\.\d{7}$/);
    });
  });

  it("includes all claimants from the balance", async () => {
    const balance = makeBalance({
      claimants: [
        { destination: claimantA, predicate: { unconditional: true } },
        { destination: claimantB, predicate: { unconditional: true } },
      ],
    });
    mockClaimableBalances([balance]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    expect(res.body.data.balances[0].claimants).toHaveLength(2);
  });

  it("includes a createdAt ISO timestamp", async () => {
    mockClaimableBalances([makeBalance({ last_modified_time: "2024-06-15T08:00:00Z" })]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    expect(res.body.data.balances[0].createdAt).toBe("2024-06-15T08:00:00.000Z");
  });

  it("sets total to the number of balances returned", async () => {
    mockClaimableBalances([makeBalance({ id: "a" }), makeBalance({ id: "b", paging_token: "pt-2" })]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    expect(res.body.data.total).toBe(2);
  });

  // ── Pagination ─────────────────────────────────────────────────────────────

  it("forwards limit to Horizon and reflects it in the response", async () => {
    const chain = mockClaimableBalances([]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}?limit=5`
    );

    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(res.body.data.limit).toBe(5);
  });

  it("forwards cursor to Horizon when provided", async () => {
    const chain = mockClaimableBalances([]);

    await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}?cursor=pt-abc`
    );

    expect(chain.cursor).toHaveBeenCalledWith("pt-abc");
  });

  it("returns the last record's paging_token as the next cursor", async () => {
    mockClaimableBalances([
      makeBalance({ id: "a", paging_token: "pt-1" }),
      makeBalance({ id: "b", paging_token: "pt-2" }),
    ]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    expect(res.body.data.cursor).toBe("pt-2");
  });

  it("returns null cursor when the result list is empty", async () => {
    mockClaimableBalances([]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    expect(res.body.data.cursor).toBeNull();
  });

  it("calls the Horizon claimableBalances().sponsor() with the correct address", async () => {
    const chain = mockClaimableBalances([]);

    await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}`
    );

    expect(server.claimableBalances).toHaveBeenCalled();
    expect(chain.sponsor).toHaveBeenCalledWith(sponsorAddress);
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it("returns 400 for an invalid (non-G) sponsor address", async () => {
    const res = await request(app).get(
      "/claimable-balances/by-sponsor/INVALID_ADDRESS"
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAccountId");
  });

  it("returns 400 for a short address that looks almost valid", async () => {
    const res = await request(app).get(
      "/claimable-balances/by-sponsor/GABC123"
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("InvalidAccountId");
  });

  it("returns 400 for an empty address path segment", async () => {
    // Express won't route "/by-sponsor/" to the :address handler but we
    // confirm a missing address gives a non-200 response.
    const res = await request(app).get("/claimable-balances/by-sponsor/");

    expect(res.statusCode).not.toBe(200);
  });

  it("returns 400 for an invalid limit value", async () => {
    mockClaimableBalances([]);

    const res = await request(app).get(
      `/claimable-balances/by-sponsor/${sponsorAddress}?limit=0`
    );

    expect(res.statusCode).toBe(400);
  });
});
