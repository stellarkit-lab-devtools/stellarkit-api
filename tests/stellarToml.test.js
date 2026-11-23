const request = require("supertest");
const app = require("../src/index");

const axios = require("axios");
const cacheService = require("../src/services/cache");

// The raw TOML text used across multiple tests
const SAMPLE_TOML = `
VERSION="1.0.0"
NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"

[DOCUMENTATION]
ORG_NAME="Example Org"
ORG_URL="https://example.com"
ORG_LOGO="https://example.com/logo.png"
ORG_DESCRIPTION="Example issuer"

[[CURRENCIES]]
code="TEST"
issuer="GTESTISSUER"
status="live"
name="Test Token"
desc="A sample currency"
anchor_asset_type="credit_alphanum4"

[[VALIDATORS]]
alias="validator1"
host="validator1.example.com"
network_passphrase="Test SDF Network ; September 2015"
history="https://history.example.com"

[[ACCOUNTS]]
name="sample"
description="Sample account"
`;

describe("GET /stellar-toml", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    cacheService.flush();
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it("returns 400 when domain is missing", async () => {
    const res = await request(app).get("/stellar-toml");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 for an invalid domain", async () => {
    const res = await request(app).get("/stellar-toml/invalid_domain!");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 404 when stellar.toml is not found", async () => {
    jest.spyOn(axios, "get").mockRejectedValue({
      response: {
        status: 404,
        data: {},
      },
    });

    const res = await request(app).get("/stellar-toml/example.com");
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain("stellar.toml not found");
  });

  // ── Normalised shape ──────────────────────────────────────────────────────

  it("returns HTTP 200 with success:true on a valid domain", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: SAMPLE_TOML });

    const res = await request(app).get("/stellar-toml/example.com");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("no snake_case or SCREAMING_SNAKE field names in the response", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: SAMPLE_TOML });

    const res = await request(app).get("/stellar-toml/example.com");
    const json = JSON.stringify(res.body.data);

    // No uppercase keys (SCREAMING_SNAKE) or snake_case should appear as
    // object keys — we check by looking for the raw strings
    expect(json).not.toMatch(/"DOCUMENTATION":/);
    expect(json).not.toMatch(/"CURRENCIES":/);
    expect(json).not.toMatch(/"VALIDATORS":/);
    expect(json).not.toMatch(/"ACCOUNTS":/);
    expect(json).not.toMatch(/"anchor_asset_type":/);
    expect(json).not.toMatch(/"network_passphrase":/);
    expect(json).not.toMatch(/"ORG_NAME":/);
  });

  it("documentation section is camelCase", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: SAMPLE_TOML });

    const res = await request(app).get("/stellar-toml/example.com");
    const { documentation } = res.body.data;

    expect(documentation).not.toBeNull();
    expect(documentation).toHaveProperty("orgName", "Example Org");
    expect(documentation).toHaveProperty("orgUrl", "https://example.com");
    expect(documentation).toHaveProperty("orgLogo", "https://example.com/logo.png");
    expect(documentation).toHaveProperty("orgDescription", "Example issuer");
  });

  it("currencies array contains camelCase entries with a normalised asset field", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: SAMPLE_TOML });

    const res = await request(app).get("/stellar-toml/example.com");
    const { currencies } = res.body.data;

    expect(Array.isArray(currencies)).toBe(true);
    expect(currencies).toHaveLength(1);

    const currency = currencies[0];
    expect(currency).toHaveProperty("code", "TEST");
    expect(currency).toHaveProperty("issuer", "GTESTISSUER");
    expect(currency).toHaveProperty("status", "live");
    expect(currency).toHaveProperty("name", "Test Token");
    // The raw anchor_asset_type must be absent
    expect(currency).not.toHaveProperty("anchorAssetType");
    expect(currency).not.toHaveProperty("anchor_asset_type");
  });

  it("each currency has a standard asset { code, issuer, type } field", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: SAMPLE_TOML });

    const res = await request(app).get("/stellar-toml/example.com");
    const currency = res.body.data.currencies[0];

    expect(currency.asset).toEqual({
      code: "TEST",
      issuer: "GTESTISSUER",
      type: "credit_alphanum4",
    });
  });

  it("validators array is camelCase", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: SAMPLE_TOML });

    const res = await request(app).get("/stellar-toml/example.com");
    const { validators } = res.body.data;

    expect(Array.isArray(validators)).toBe(true);
    expect(validators[0]).toHaveProperty("alias", "validator1");
    expect(validators[0]).toHaveProperty("host", "validator1.example.com");
    expect(validators[0]).toHaveProperty("networkPassphrase");
    expect(validators[0]).toHaveProperty("history");
  });

  it("optional sections absent from TOML are returned as null", async () => {
    const minimalToml = `VERSION="1.0.0"\n`;
    jest.spyOn(axios, "get").mockResolvedValue({ data: minimalToml });

    const res = await request(app).get("/stellar-toml/minimal.com");
    const data = res.body.data;

    expect(data).toHaveProperty("documentation", null);
    expect(data).toHaveProperty("currencies", null);
    expect(data).toHaveProperty("validators", null);
    expect(data).toHaveProperty("accounts", null);
    expect(data).toHaveProperty("principals", null);
  });

  it("calls the TOML URL with the correct User-Agent header", async () => {
    const spy = jest.spyOn(axios, "get").mockResolvedValue({ data: SAMPLE_TOML });

    await request(app).get("/stellar-toml/example.com");

    expect(spy).toHaveBeenCalledWith(
      "https://example.com/.well-known/stellar.toml",
      expect.objectContaining({
        timeout: 5000,
        headers: expect.objectContaining({ "User-Agent": "StellarKit-API/1.0" }),
      }),
    );
  });

  // ── Caching ───────────────────────────────────────────────────────────────

  it("sets X-Cache: MISS on first request", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: SAMPLE_TOML });

    const res = await request(app).get("/stellar-toml/example.com");
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("sets X-Cache: HIT on the second request for the same domain", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: SAMPLE_TOML });

    await request(app).get("/stellar-toml/example.com");
    const res = await request(app).get("/stellar-toml/example.com");

    expect(res.headers["x-cache"]).toBe("HIT");
    // axios.get should only have been called once — second served from cache
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it("?fresh=true bypasses the cache and returns X-Cache: MISS", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: SAMPLE_TOML });

    // Prime the cache
    await request(app).get("/stellar-toml/example.com");
    expect(axios.get).toHaveBeenCalledTimes(1);

    // Fresh request must bypass cache
    const res = await request(app).get("/stellar-toml/example.com?fresh=true");
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it("X-Cache header is always present (both HIT and MISS)", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: SAMPLE_TOML });

    const res1 = await request(app).get("/stellar-toml/example.com");
    const res2 = await request(app).get("/stellar-toml/example.com");

    expect(res1.headers).toHaveProperty("x-cache");
    expect(res2.headers).toHaveProperty("x-cache");
  });

  it("different domains are cached independently", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: SAMPLE_TOML });

    await request(app).get("/stellar-toml/domain-a.com");
    const resB = await request(app).get("/stellar-toml/domain-b.com");

    // Both should be MISS because they are different keys
    expect(resB.headers["x-cache"]).toBe("MISS");
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});
