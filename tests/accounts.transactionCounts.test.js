/**
 * Tests for POST /accounts/transaction-counts
 *
 * Verifies that the endpoint:
 *   - Accepts up to 20 Stellar addresses and returns their transaction counts
 *   - Returns 400 when addresses array exceeds 20 entries
 *   - Returns 400 when addresses field is missing or not an array
 *   - Returns { count: 0, firstTransactionAt: null, lastTransactionAt: null }
 *     for non-existent accounts
 *   - Returns correct count, firstTransactionAt and lastTransactionAt for
 *     existing accounts
 *
 * All Stellar SDK calls are mocked; no real network requests are made.
 */

const request = require("supertest");

jest.mock("../src/config/stellar", () => {
  const mockTransactionsBuilder = () => ({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn(),
  });

  return {
    server: {
      transactions: jest.fn(mockTransactionsBuilder),
      loadAccount: jest.fn(),
    },
    NETWORK: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
    fetchAccountCreation: jest.fn(),
    sorobanServer: null,
    sorobanRpcUrl: null,
  };
});

const app = require("../src/index");
const { server } = require("../src/config/stellar");

const ADDR_1 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const ADDR_2 = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";
const ADDR_3 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

/** Build a mock transactions() chain that returns the given pages. */
function mockTransactionPages(pages) {
  let callCount = 0;
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockImplementation(() => {
      const page = pages[callCount] || { records: [] };
      callCount++;
      return Promise.resolve(page);
    }),
  };
  server.transactions.mockReturnValue(chain);
  return chain;
}

/** Build a single-page transaction result with n records. */
function buildTxPage(records) {
  return { records };
}

/** Build a minimal transaction record. */
function buildTxRecord(overrides = {}) {
  return {
    created_at: "2024-01-15T12:00:00Z",
    paging_token: "12345",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Success cases ─────────────────────────────────────────────────────────────

describe("POST /accounts/transaction-counts — success", () => {
  it("returns 200 with count and timestamps for a single existing account", async () => {
    mockTransactionPages([
      buildTxPage([
        buildTxRecord({ created_at: "2022-01-01T00:00:00Z", paging_token: "1" }),
        buildTxRecord({ created_at: "2024-06-15T12:30:00Z", paging_token: "2" }),
      ]),
      buildTxPage([]), // end of pages
    ]);

    const res = await request(app)
      .post("/accounts/transaction-counts")
      .send({ addresses: [ADDR_1] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const result = res.body.data.results[ADDR_1];
    expect(result.count).toBe(2);
    expect(result.firstTransactionAt).toBe("2022-01-01T00:00:00.000Z");
    expect(result.lastTransactionAt).toBe("2024-06-15T12:30:00.000Z");
  });

  it("returns count: 0 and null timestamps for a non-existent account (Horizon 404)", async () => {
    const chain = {
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockRejectedValue({ response: { status: 404 } }),
    };
    server.transactions.mockReturnValue(chain);

    const res = await request(app)
      .post("/accounts/transaction-counts")
      .send({ addresses: [ADDR_1] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const result = res.body.data.results[ADDR_1];
    expect(result.count).toBe(0);
    expect(result.firstTransactionAt).toBeNull();
    expect(result.lastTransactionAt).toBeNull();
  });

  it("returns results for multiple addresses in one response", async () => {
    // Alternate mock per address by using different pages on each transactions() call
    let callIndex = 0;
    const pages = [
      // ADDR_1 — 3 transactions, single page
      [
        buildTxPage([
          buildTxRecord({ created_at: "2021-01-01T00:00:00Z", paging_token: "1" }),
          buildTxRecord({ created_at: "2021-06-01T00:00:00Z", paging_token: "2" }),
          buildTxRecord({ created_at: "2022-01-01T00:00:00Z", paging_token: "3" }),
        ]),
        buildTxPage([]),
      ],
      // ADDR_2 — 0 transactions (404)
      null,
    ];

    server.transactions.mockImplementation(() => {
      const idx = callIndex++;
      if (pages[idx] === null) {
        // Simulate 404 for ADDR_2
        return {
          forAccount: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          cursor: jest.fn().mockReturnThis(),
          call: jest.fn().mockRejectedValue({ response: { status: 404 } }),
        };
      }
      let pageIdx = 0;
      return {
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        cursor: jest.fn().mockReturnThis(),
        call: jest.fn().mockImplementation(() =>
          Promise.resolve(pages[idx][pageIdx++] || { records: [] })
        ),
      };
    });

    const res = await request(app)
      .post("/accounts/transaction-counts")
      .send({ addresses: [ADDR_1, ADDR_2] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const results = res.body.data.results;
    expect(results[ADDR_1].count).toBe(3);
    expect(results[ADDR_2].count).toBe(0);
    expect(results[ADDR_2].firstTransactionAt).toBeNull();
  });

  it("response data contains a 'results' object keyed by address", async () => {
    mockTransactionPages([buildTxPage([]), ]);

    const res = await request(app)
      .post("/accounts/transaction-counts")
      .send({ addresses: [ADDR_1] });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty("results");
    expect(typeof res.body.data.results).toBe("object");
    expect(res.body.data.results).toHaveProperty(ADDR_1);
  });

  it("each result entry has count, firstTransactionAt, and lastTransactionAt keys", async () => {
    mockTransactionPages([buildTxPage([buildTxRecord()]), buildTxPage([])]);

    const res = await request(app)
      .post("/accounts/transaction-counts")
      .send({ addresses: [ADDR_1] });

    expect(res.statusCode).toBe(200);
    const entry = res.body.data.results[ADDR_1];
    expect(entry).toHaveProperty("count");
    expect(entry).toHaveProperty("firstTransactionAt");
    expect(entry).toHaveProperty("lastTransactionAt");
  });
});

// ── Over-limit (>20 addresses) ────────────────────────────────────────────────

describe("POST /accounts/transaction-counts — over limit", () => {
  it("returns 400 when more than 20 addresses are provided", async () => {
    // Generate 21 distinct valid-looking addresses (reuse the same valid key for simplicity)
    const tooMany = Array(21).fill(ADDR_1);

    const res = await request(app)
      .post("/accounts/transaction-counts")
      .send({ addresses: tooMany });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/20/);
  });

  it("allows exactly 20 addresses", async () => {
    // All point to the same valid address — 20 separate 404 responses
    server.transactions.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockRejectedValue({ response: { status: 404 } }),
    });

    const exactly20 = Array(20).fill(ADDR_1);

    const res = await request(app)
      .post("/accounts/transaction-counts")
      .send({ addresses: exactly20 });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── Missing or invalid body ───────────────────────────────────────────────────

describe("POST /accounts/transaction-counts — invalid input", () => {
  it("returns 400 when addresses field is missing", async () => {
    const res = await request(app)
      .post("/accounts/transaction-counts")
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 when addresses is not an array", async () => {
    const res = await request(app)
      .post("/accounts/transaction-counts")
      .send({ addresses: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when addresses array is empty", async () => {
    const res = await request(app)
      .post("/accounts/transaction-counts")
      .send({ addresses: [] });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when an address is not a valid Stellar public key", async () => {
    const res = await request(app)
      .post("/accounts/transaction-counts")
      .send({ addresses: ["NOT_A_VALID_KEY"] });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when body is missing entirely", async () => {
    const res = await request(app)
      .post("/accounts/transaction-counts");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
