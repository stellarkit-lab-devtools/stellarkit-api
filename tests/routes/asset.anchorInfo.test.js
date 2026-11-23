/**
 * Tests for GET /asset/:code/:issuer/anchor-info
 *
 * Verifies the 5-minute cache behaviour:
 *   1. First request → X-Cache: MISS
 *   2. Second identical request → X-Cache: HIT
 *   3. ?fresh=true → X-Cache: MISS even after a cached response exists
 *   4. Cached response body matches the original response exactly
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

// ── Mock stellar config ────────────────────────────────────────────────────
jest.mock("../../src/config/stellar", () => {
  const originalModule = jest.requireActual("../../src/config/stellar");
  return {
    ...originalModule,
    server: { loadAccount: jest.fn() },
    NETWORK: "testnet",
  };
});

// ── Mock tomlResolver so we don't make real HTTP calls ────────────────────
jest.mock("../../src/utils/tomlResolver", () => ({
  fetchNormalisedToml: jest.fn(),
  getAssetMetadataFromToml: jest.fn(),
  fetchStellarToml: jest.fn(),
}));

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const { fetchNormalisedToml } = require("../../src/utils/tomlResolver");
const cacheService = require("../../src/services/cache");

// Use random keypairs so tests are isolated from each other
const ISSUER = Keypair.random().publicKey();
const CODE = "USDC";
const BASE_URL = `/asset/${CODE}/${ISSUER}/anchor-info`;

const MOCK_TOML = {
  currencies: [
    {
      code: "USDC",
      issuer: ISSUER,
      name: "USD Coin",
      desc: "A fully reserved stablecoin.",
      image: "https://example.com/usdc.png",
      anchor_asset_type: "fiat",
      conditions: "Terms apply.",
    },
  ],
  documentation: {
    ORG_NAME: "Circle",
    ORG_URL: "https://circle.com",
    ORG_LOGO: "https://circle.com/logo.png",
  },
};

function mockIssuerAccount() {
  server.loadAccount.mockResolvedValue({
    id: ISSUER,
    home_domain: "example.com",
    balances: [],
    signers: [],
    thresholds: {},
    flags: {},
    subentry_count: 0,
    last_modified_ledger: 1,
    sequence: "1",
    data_attr: {},
  });
}

function mockTomlFetch() {
  fetchNormalisedToml.mockResolvedValue({ toml: MOCK_TOML });
}

describe("GET /asset/:code/:issuer/anchor-info — caching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    mockIssuerAccount();
    mockTomlFetch();
  });

  // ── 1. First request returns X-Cache: MISS ─────────────────────────────
  it("returns X-Cache: MISS on the first request", async () => {
    const res = await request(app).get(BASE_URL);

    expect(res.statusCode).toBe(200);
    expect(res.get("X-Cache")).toBe("MISS");
    expect(res.body.success).toBe(true);
  });

  // ── 2. Second identical request returns X-Cache: HIT ──────────────────
  it("returns X-Cache: HIT on the second identical request", async () => {
    // Prime the cache
    const res1 = await request(app).get(BASE_URL);
    expect(res1.get("X-Cache")).toBe("MISS");

    // Second call — should be served from cache
    const res2 = await request(app).get(BASE_URL);
    expect(res2.statusCode).toBe(200);
    expect(res2.get("X-Cache")).toBe("HIT");

    // Horizon + TOML should have been called only once (for the first request)
    expect(server.loadAccount).toHaveBeenCalledTimes(1);
    expect(fetchNormalisedToml).toHaveBeenCalledTimes(1);
  });

  // ── 3. ?fresh=true returns X-Cache: MISS even after cached response ────
  it("returns X-Cache: MISS with ?fresh=true even when a cached response exists", async () => {
    // Prime the cache
    const res1 = await request(app).get(BASE_URL);
    expect(res1.get("X-Cache")).toBe("MISS");

    // Fresh request should bypass cache
    const freshRes = await request(app).get(`${BASE_URL}?fresh=true`);
    expect(freshRes.statusCode).toBe(200);
    expect(freshRes.get("X-Cache")).toBe("MISS");

    // Horizon + TOML fetched twice (once for prime, once for fresh)
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
    expect(fetchNormalisedToml).toHaveBeenCalledTimes(2);
  });

  // ── 4. Cached response matches the original response exactly ──────────
  it("serves a cached response that matches the original response body exactly", async () => {
    const res1 = await request(app).get(BASE_URL);
    expect(res1.statusCode).toBe(200);
    expect(res1.get("X-Cache")).toBe("MISS");

    const res2 = await request(app).get(BASE_URL);
    expect(res2.statusCode).toBe(200);
    expect(res2.get("X-Cache")).toBe("HIT");

    // Data payloads must be identical
    expect(res2.body.data).toEqual(res1.body.data);
    expect(res2.body.success).toBe(res1.body.success);
  });

  // ── Response shape ────────────────────────────────────────────────────
  it("returns the expected anchor-info response shape", async () => {
    const res = await request(app).get(BASE_URL);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      asset: {
        code: CODE,
        issuer: ISSUER,
      },
      anchor: {
        homeDomain: "example.com",
        name: "USD Coin",
        description: "A fully reserved stablecoin.",
        image: "https://example.com/usdc.png",
        anchorAssetType: "fiat",
        conditions: "Terms apply.",
        orgName: "Circle",
        orgUrl: "https://circle.com",
        orgLogo: "https://circle.com/logo.png",
      },
    });
  });

  // ── ?fresh=true repopulates cache ─────────────────────────────────────
  it("repopulates the cache after ?fresh=true so the next call is a HIT", async () => {
    // Prime
    await request(app).get(BASE_URL);
    // Fresh bypass (repopulates)
    await request(app).get(`${BASE_URL}?fresh=true`);
    // Next call must hit the freshly populated cache
    const res = await request(app).get(BASE_URL);
    expect(res.get("X-Cache")).toBe("HIT");
    // Total Horizon calls: prime + fresh = 2
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
  });

  // ── null toml gracefully ─────────────────────────────────────────────
  it("returns null anchor fields when toml fetch fails", async () => {
    fetchNormalisedToml.mockRejectedValue(new Error("Network error"));

    const res = await request(app).get(BASE_URL);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.anchor.name).toBeNull();
    expect(res.body.data.anchor.description).toBeNull();
  });

  it("returns homeDomain: null when issuer has no home_domain", async () => {
    server.loadAccount.mockResolvedValue({
      id: ISSUER,
      home_domain: null,
      balances: [],
      signers: [],
      thresholds: {},
      flags: {},
      subentry_count: 0,
      last_modified_ledger: 1,
      sequence: "1",
      data_attr: {},
    });

    const res = await request(app).get(BASE_URL);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.anchor.homeDomain).toBeNull();
  });

  // ── Error paths ───────────────────────────────────────────────────────
  it("returns 400 for an invalid asset code", async () => {
    // Asset codes must be 1–12 alphanumeric characters; 13 chars is invalid
    const res = await request(app).get(`/asset/TOOLONGCODE13/${ISSUER}/anchor-info`);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 for an invalid issuer", async () => {
    const res = await request(app).get(`/asset/${CODE}/BADKEY/anchor-info`);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
