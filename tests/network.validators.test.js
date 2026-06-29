"use strict";

const request = require("supertest");

const originalFetch = global.fetch;

jest.mock("../src/config/stellar", () => {
  const mockServer = {
    ledgers: () => ({
      order: () => ({
        limit: () => ({
          call: () =>
            Promise.resolve({
              records: [
                {
                  sequence: 100,
                  closed_at: "2024-01-01T00:00:00Z",
                  successful_transaction_count: 10,
                  operation_count: 20,
                  total_coins: "1000000",
                  fee_pool: "100",
                  base_fee_in_stroops: 100,
                  base_reserve_in_stroops: 5000000,
                  protocol_version: 20,
                },
              ],
            }),
        }),
      }),
    }),
    feeStats: () =>
      Promise.resolve({
        fee_charged: { min: "100", p10: "100", p50: "200", p95: "500", p99: "1000", max: "5000" },
        last_ledger_base_fee: "100",
        ledger_capacity_usage: "0.5",
      }),
  };

  return {
    server: mockServer,
    horizonUrl: "https://horizon-testnet.stellar.org",
    NETWORK: "testnet",
    NETWORKS: { testnet: "https://horizon-testnet.stellar.org" },
    fetchAccountCreation: jest.fn(),
  };
});

const app = require("../src/index");

const MOCK_ACCOUNTS_BODY = {
  _embedded: {
    records: [
      {
        account_id: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        home_domain: "stellar.org",
        last_modified_ledger: 99,
        subentry_count: 5,
        flags: { auth_required: false, auth_revocable: false },
        signers: [{ key: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", weight: 1 }],
      },
      {
        account_id: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        home_domain: "stellar.org",
        last_modified_ledger: 98,
        subentry_count: 3,
        flags: { auth_required: true, auth_revocable: false },
        signers: [{ key: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", weight: 1 }],
      },
      {
        account_id: "GCFONE23AB7Y6C5YZOMKUKGETPIAJA752UDKDKEQGUQPTTAQE2MFHBMZ",
        home_domain: null,
        last_modified_ledger: 97,
        subentry_count: 1,
        flags: { auth_required: false },
        signers: [
          { key: "GCFONE23AB7Y6C5YZOMKUKGETPIAJA752UDKDKEQGUQPTTAQE2MFHBMZ", weight: 1 },
          { key: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", weight: 1 },
        ],
      },
    ],
  },
};

function mockFetchForValidators() {
  global.fetch = jest.fn((url) => {
    if (url.includes("/accounts")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(MOCK_ACCOUNTS_BODY),
      });
    }
    return originalFetch(url);
  });
}

describe("GET /network/validators", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const cacheService = require("../src/services/cache");
    if (cacheService.flush) cacheService.flush();
    else if (cacheService.flushAll) cacheService.flushAll();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("returns a normalised validator list with success envelope", async () => {
    mockFetchForValidators();

    const response = await request(app).get("/network/validators").expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("validators");
    expect(response.body.data).toHaveProperty("total");
    expect(Array.isArray(response.body.data.validators)).toBe(true);
    expect(response.body.data.total).toBe(response.body.data.validators.length);
  });

  it("includes publicKey, homeDomain, isOrganization, history, and currentStatus", async () => {
    mockFetchForValidators();

    const response = await request(app).get("/network/validators").expect(200);

    const validator = response.body.data.validators[0];
    expect(validator).toHaveProperty("publicKey");
    expect(validator).toHaveProperty("homeDomain");
    expect(validator).toHaveProperty("isOrganization");
    expect(validator).toHaveProperty("history");
    expect(validator).toHaveProperty("currentStatus");
  });

  it("has no snake_case fields in the response", async () => {
    mockFetchForValidators();

    const response = await request(app).get("/network/validators").expect(200);

    const json = JSON.stringify(response.body.data);
    expect(json).not.toMatch(/"[a-z]+_[a-z]+"\s*:/);
  });

  it("groups validators by organisation", async () => {
    mockFetchForValidators();

    const response = await request(app).get("/network/validators").expect(200);

    expect(response.body.data).toHaveProperty("byOrganisation");
    expect(response.body.data.byOrganisation["stellar.org"]).toBeDefined();
    expect(response.body.data.byOrganisation["stellar.org"].length).toBeGreaterThanOrEqual(1);
  });

  it("returns an error when Horizon responds with non-ok status", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ detail: "Service unavailable" }),
      }),
    );

    const response = await request(app).get("/network/validators?fresh=true");

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.success).toBe(false);
  });
});
