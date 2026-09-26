/**
 * Tests for GET /asset/:code/:issuer/verify
 *
 * Covers:
 *  1. Issuer with auth_required flag set and a valid home domain → verified: true
 *  2. Issuer with no home domain → verified: false with a reason
 *  3. Invalid issuer address → 400
 *  4. Issuer whose TOML cannot be fetched → verified: false with tomlFetchFailed reason
 *
 * Both the Stellar SDK (server.loadAccount) and axios (TOML fetch) are mocked
 * so tests never make real network requests.
 */

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const axios = require("axios");

const ASSET_CODE = "USDC";
const ASSET_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// Minimal stellar.toml that lists the test asset in [[CURRENCIES]]
function buildTomlWithCurrency(code, issuer) {
  return `
VERSION="2.0.0"

[[CURRENCIES]]
code="${code}"
issuer="${issuer}"
name="Test ${code}"
`;
}

describe("GET /asset/:code/:issuer/verify", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── 1. auth_required flag + valid home domain → verified: true ─────────────
  it("returns verified: true for an issuer with auth_required set and a valid home domain", async () => {
    // Mock the Stellar SDK to return an account with a home_domain and
    // auth_required flag set.
    jest.spyOn(server, "loadAccount").mockResolvedValue({
      id: ASSET_ISSUER,
      home_domain: "circle.com",
      flags: {
        auth_required: true,
        auth_revocable: false,
        auth_immutable: false,
      },
    });

    // Mock axios so the stellar.toml fetch succeeds and lists the currency.
    jest.spyOn(axios, "get").mockResolvedValue({
      data: buildTomlWithCurrency(ASSET_CODE, ASSET_ISSUER),
    });

    const res = await request(app).get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/verify`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verified).toBe(true);

    // All four checks must have passed
    const { checks } = res.body.data;
    expect(checks.accountExists.passed).toBe(true);
    expect(checks.hasHomeDomain.passed).toBe(true);
    expect(checks.tomlReachable.passed).toBe(true);
    expect(checks.listedInToml.passed).toBe(true);
  });

  // ── 2. No home domain → verified: false with a reason ─────────────────────
  it("returns verified: false when the issuer has no home_domain set", async () => {
    // Account exists but has no home_domain.
    jest.spyOn(server, "loadAccount").mockResolvedValue({
      id: ASSET_ISSUER,
      home_domain: undefined, // missing
      flags: { auth_required: false },
    });

    const res = await request(app).get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/verify`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verified).toBe(false);

    const { checks } = res.body.data;
    // Account was found
    expect(checks.accountExists.passed).toBe(true);
    // But home domain check must have failed
    expect(checks.hasHomeDomain.passed).toBe(false);
    // Downstream checks are not meaningful without a home domain
    expect(checks.tomlReachable.passed).toBe(false);
    expect(checks.listedInToml.passed).toBe(false);
  });

  // ── 3. Invalid issuer address → 400 ───────────────────────────────────────
  it("returns 400 for an invalid issuer address", async () => {
    const invalidIssuer = "NOT_A_VALID_STELLAR_KEY";

    const res = await request(app).get(`/asset/${ASSET_CODE}/${invalidIssuer}/verify`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    // The route uses validateAsset which throws an InvalidAsset error
    expect(res.body.error.type).toBe("InvalidAsset");
  });

  // ── 4. TOML fetch fails → verified: false with tomlFetchFailed reason ──────
  it("returns verified: false when the issuer stellar.toml cannot be fetched", async () => {
    // Account exists and has a home domain, so the first two checks pass.
    jest.spyOn(server, "loadAccount").mockResolvedValue({
      id: ASSET_ISSUER,
      home_domain: "unreachable-domain.example.com",
      flags: { auth_required: false },
    });

    // Mock axios to simulate a network failure when fetching stellar.toml.
    jest.spyOn(axios, "get").mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );

    const res = await request(app).get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/verify`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verified).toBe(false);

    const { checks } = res.body.data;
    // Account and home domain checks passed
    expect(checks.accountExists.passed).toBe(true);
    expect(checks.hasHomeDomain.passed).toBe(true);
    // TOML fetch failed — route returns early, so tomlReachable is false
    expect(checks.tomlReachable.passed).toBe(false);
    // listedInToml cannot be checked when toml is unavailable
    expect(checks.listedInToml.passed).toBe(false);
  });
});
