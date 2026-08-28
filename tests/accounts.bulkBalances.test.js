/**
 * Tests for POST /accounts/balances (feature c).
 *
 * Acceptance criteria:
 *   - Accepts { addresses: ["G...", "G..."] } with a maximum of 20 addresses.
 *   - Returns { success: true, data: { results: { "G...": { balances: [...] } } } }
 *   - Addresses exceeding 20 return 400.
 *   - Invalid addresses return an error entry for that address rather than
 *     failing the whole request.
 *   - Tests cover valid, mixed valid/invalid, and over-limit arrays.
 *
 * All Stellar SDK calls are mocked — no network calls are made.
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

// Mock the stellar module before requiring app so server.loadAccount is
// a Jest mock function throughout the test suite.
jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
    transactions: jest.fn(),
    operations: jest.fn(),
  },
  NETWORK: "testnet",
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");

// ── Test addresses ─────────────────────────────────────────────────────────

const ADDR_A = Keypair.random().publicKey();  // valid, funded
const ADDR_B = Keypair.random().publicKey();  // valid, funded
const ADDR_C = Keypair.random().publicKey();  // valid but account not found
const INVALID_ADDR = "NOT_A_VALID_STELLAR_KEY";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Minimal Horizon account payload with one XLM balance and one asset balance.
 */
function buildHorizonAccount(address, opts = {}) {
  return {
    id: address,
    balances: [
      {
        asset_type: "native",
        balance: opts.xlmBalance || "100.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
      },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        balance: opts.usdcBalance || "50.0000000",
        limit: "1000.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
        is_authorized: true,
        is_clawback_enabled: false,
      },
    ],
  };
}

/** Horizon 404 error (account not found). */
function horizonNotFound() {
  return { response: { status: 404 } };
}

/** Generate an array of N valid random Stellar addresses. */
function generateAddresses(n) {
  return Array.from({ length: n }, () => Keypair.random().publicKey());
}

// ── Setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Suite ──────────────────────────────────────────────────────────────────

describe("POST /accounts/balances", () => {

  // ── Valid array ──────────────────────────────────────────────────────────

  describe("valid address array", () => {
    it("returns 200 with results keyed by address", async () => {
      server.loadAccount.mockImplementation((addr) =>
        Promise.resolve(buildHorizonAccount(addr))
      );

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: [ADDR_A, ADDR_B] });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("results");
    });

    it("response keys match the requested addresses", async () => {
      server.loadAccount.mockImplementation((addr) =>
        Promise.resolve(buildHorizonAccount(addr))
      );

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: [ADDR_A, ADDR_B] });

      const { results } = res.body.data;
      expect(Object.keys(results)).toContain(ADDR_A);
      expect(Object.keys(results)).toContain(ADDR_B);
      expect(Object.keys(results)).toHaveLength(2);
    });

    it("each result entry has a balances array", async () => {
      server.loadAccount.mockImplementation((addr) =>
        Promise.resolve(buildHorizonAccount(addr))
      );

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: [ADDR_A] });

      const entry = res.body.data.results[ADDR_A];
      expect(entry).toHaveProperty("balances");
      expect(Array.isArray(entry.balances)).toBe(true);
    });

    it("balances array includes the native XLM entry first", async () => {
      server.loadAccount.mockImplementation((addr) =>
        Promise.resolve(buildHorizonAccount(addr))
      );

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: [ADDR_A] });

      const { balances } = res.body.data.results[ADDR_A];
      expect(balances[0].asset.code).toBe("XLM");
      expect(balances[0].asset.type).toBe("native");
    });

    it("balances array includes non-native asset entries", async () => {
      server.loadAccount.mockImplementation((addr) =>
        Promise.resolve(buildHorizonAccount(addr))
      );

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: [ADDR_A] });

      const { balances } = res.body.data.results[ADDR_A];
      const usdc = balances.find((b) => b.asset.code === "USDC");
      expect(usdc).toBeDefined();
      expect(usdc.asset.issuer).toBe("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
    });

    it("fetches each address exactly once", async () => {
      server.loadAccount.mockImplementation((addr) =>
        Promise.resolve(buildHorizonAccount(addr))
      );

      await request(app)
        .post("/accounts/balances")
        .send({ addresses: [ADDR_A, ADDR_B] });

      expect(server.loadAccount).toHaveBeenCalledTimes(2);
      expect(server.loadAccount).toHaveBeenCalledWith(ADDR_A);
      expect(server.loadAccount).toHaveBeenCalledWith(ADDR_B);
    });

    it("accepts exactly 20 addresses (boundary — max allowed)", async () => {
      server.loadAccount.mockImplementation((addr) =>
        Promise.resolve(buildHorizonAccount(addr))
      );
      const addrs = generateAddresses(20);

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: addrs });

      expect(res.statusCode).toBe(200);
      expect(Object.keys(res.body.data.results)).toHaveLength(20);
    });
  });

  // ── Mixed valid / invalid addresses ──────────────────────────────────────

  describe("mixed valid and invalid addresses", () => {
    it("returns 200 even when one address is invalid", async () => {
      server.loadAccount.mockImplementation((addr) =>
        Promise.resolve(buildHorizonAccount(addr))
      );

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: [ADDR_A, INVALID_ADDR] });

      expect(res.statusCode).toBe(200);
    });

    it("valid address gets a balances entry", async () => {
      server.loadAccount.mockImplementation((addr) =>
        Promise.resolve(buildHorizonAccount(addr))
      );

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: [ADDR_A, INVALID_ADDR] });

      const { results } = res.body.data;
      expect(results[ADDR_A]).toHaveProperty("balances");
    });

    it("invalid address gets an error entry with type InvalidAddress", async () => {
      server.loadAccount.mockImplementation((addr) =>
        Promise.resolve(buildHorizonAccount(addr))
      );

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: [ADDR_A, INVALID_ADDR] });

      const { results } = res.body.data;
      expect(results[INVALID_ADDR]).toHaveProperty("error");
      expect(results[INVALID_ADDR].error.type).toBe("InvalidAddress");
    });

    it("account-not-found address gets an error entry with type AccountNotFound", async () => {
      server.loadAccount.mockImplementation((addr) => {
        if (addr === ADDR_C) return Promise.reject(horizonNotFound());
        return Promise.resolve(buildHorizonAccount(addr));
      });

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: [ADDR_A, ADDR_C] });

      const { results } = res.body.data;
      expect(results[ADDR_A]).toHaveProperty("balances");
      expect(results[ADDR_C]).toHaveProperty("error");
      expect(results[ADDR_C].error.type).toBe("AccountNotFound");
    });

    it("error entry for invalid address does NOT fail the whole batch", async () => {
      server.loadAccount.mockImplementation((addr) =>
        Promise.resolve(buildHorizonAccount(addr))
      );

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: [ADDR_A, INVALID_ADDR, ADDR_B] });

      // All three keys present — two valid, one error
      expect(Object.keys(res.body.data.results)).toHaveLength(3);
    });

    it("all-invalid array returns 200 with all error entries", async () => {
      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: ["BAAD1", "BAAD2"] });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.results["BAAD1"].error.type).toBe("InvalidAddress");
      expect(res.body.data.results["BAAD2"].error.type).toBe("InvalidAddress");
    });
  });

  // ── Over-limit (> 20) ────────────────────────────────────────────────────

  describe("over-limit address array", () => {
    it("returns 400 when 21 addresses are submitted", async () => {
      const addrs = generateAddresses(21);

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: addrs });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("error message mentions the maximum of 20", async () => {
      const addrs = generateAddresses(25);

      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: addrs });

      expect(res.body.error.message).toMatch(/20/);
    });

    it("does not call loadAccount for over-limit requests", async () => {
      const addrs = generateAddresses(21);

      await request(app)
        .post("/accounts/balances")
        .send({ addresses: addrs });

      expect(server.loadAccount).not.toHaveBeenCalled();
    });
  });

  // ── Missing / malformed body ─────────────────────────────────────────────

  describe("missing or malformed body", () => {
    it("returns 400 when addresses field is missing", async () => {
      const res = await request(app)
        .post("/accounts/balances")
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when addresses is not an array", async () => {
      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: "GABC..." });

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when addresses array is empty", async () => {
      const res = await request(app)
        .post("/accounts/balances")
        .send({ addresses: [] });

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with no body at all", async () => {
      const res = await request(app)
        .post("/accounts/balances");

      expect(res.statusCode).toBe(400);
    });
  });
});
