const request = require("supertest");
const app = require("../src/index");

/**
 * Tests for the validateAsset(code, issuer) utility via the
 * /asset/:code/:issuer endpoint (and related sub-routes).
 *
 * Covers the acceptance criteria from issue #328:
 *  - Missing issuer returns standardised 400 InvalidAsset shape
 *  - Oversized code (> 12 chars) returns standardised 400 InvalidAsset shape
 *  - Invalid issuer address returns standardised 400 InvalidAsset shape
 */

// A well-formed Stellar public key used as a valid issuer reference.
const VALID_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// Utility: assert the standard InvalidAsset 400 shape
function expectInvalidAsset(res) {
  expect(res.statusCode).toBe(400);
  expect(res.body.success).toBe(false);
  expect(res.body.error).toMatchObject({
    type: "InvalidAsset",
    message: expect.any(String),
    suggestion: expect.any(String),
  });
}

// /utils/validate-asset (existing endpoint)
describe("GET /utils/validate-asset", () => {
  it("validates XLM as native asset (case-insensitive)", async () => {
    const resUpper = await request(app).get("/utils/validate-asset?code=XLM");
    expect(resUpper.statusCode).toBe(200);
    expect(resUpper.body.success).toBe(true);
    expect(resUpper.body.data).toEqual({
      input: "XLM",
      isValid: true,
      assetType: "native",
      reason: null,
    });

    const resLower = await request(app).get("/utils/validate-asset?code=xlm");
    expect(resLower.statusCode).toBe(200);
    expect(resLower.body.success).toBe(true);
    expect(resLower.body.data).toEqual({
      input: "xlm",
      isValid: true,
      assetType: "native",
      reason: null,
    });
  });

  it("validates a valid 4-character asset code", async () => {
    const res = await request(app).get("/utils/validate-asset?code=USDC");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      input: "USDC",
      isValid: true,
      assetType: "credit_alphanum4",
      reason: null,
    });
  });

  it("validates a valid 12-character asset code", async () => {
    const code = "ABCDEFGHIJKL";
    const res = await request(app).get(`/utils/validate-asset?code=${code}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      input: code,
      isValid: true,
      assetType: "credit_alphanum12",
      reason: null,
    });
  });

  it("fails validation for a code that is too long (> 12 characters)", async () => {
    const code = "ABCDEFGHIJKLM"; // 13 chars
    const res = await request(app).get(`/utils/validate-asset?code=${code}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      input: code,
      isValid: false,
      assetType: null,
      reason: "Asset code is too long (maximum 12 characters).",
    });
  });

  it("fails validation for codes with special characters", async () => {
    const res = await request(app).get("/utils/validate-asset?code=US$C");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      input: "US$C",
      isValid: false,
      assetType: "credit_alphanum4",
      reason: "Asset code contains invalid characters. Only alphanumeric characters are allowed.",
    });
  });

  it("returns 400 when the code parameter is missing", async () => {
    const res = await request(app).get("/utils/validate-asset");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toEqual({
      type: "ValidationError",
      message: "Query parameter 'code' is required.",
    });
  });

  it("returns 400 when the code parameter is empty", async () => {
    const res = await request(app).get("/utils/validate-asset?code=");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toEqual({
      type: "ValidationError",
      message: "Query parameter 'code' is required.",
    });
  });
});

// validateAsset route-param validation via /asset/:code/:issuer
describe("validateAsset(code, issuer) — route param validation via /asset/:code/:issuer", () => {
  jest.mock("../src/config/stellar", () => {
    const original = jest.requireActual("../src/config/stellar");
    return {
      ...original,
      server: {
        assets: jest.fn(() => ({
          forCode: jest.fn().mockReturnThis(),
          forIssuer: jest.fn().mockReturnThis(),
          call: jest.fn().mockResolvedValue({ records: [] }),
        })),
        accounts: jest.fn(() => ({
          forAsset: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          call: jest.fn().mockResolvedValue({ records: [] }),
        })),
        loadAccount: jest.fn().mockRejectedValue(new Error("not found")),
      },
    };
  });

  it("returns 400 InvalidAsset for an oversized asset code (> 12 chars)", async () => {
    const longCode = "ABCDEFGHIJKLM"; // 13 chars
    const res = await request(app).get(`/asset/${longCode}/${VALID_ISSUER}`);
    expectInvalidAsset(res);
    expect(res.body.error.message).toMatch(/too long/i);
    expect(res.body.error.suggestion).toMatch(/12/);
  });

  it("returns 400 InvalidAsset for an asset code that is exactly 13 characters", async () => {
    const longCode = "TOOLONGASSETC"; // 13 chars
    const res = await request(app).get(`/asset/${longCode}/${VALID_ISSUER}/supply`);
    expectInvalidAsset(res);
    expect(res.body.error.message).toMatch(/too long/i);
  });

  it("returns 400 InvalidAsset for an asset code with special characters", async () => {
    const badCode = "US$C";
    const res = await request(app).get(`/asset/${badCode}/${VALID_ISSUER}`);
    expectInvalidAsset(res);
    expect(res.body.error.message).toMatch(/invalid character/i);
  });

  it("returns 400 InvalidAsset when issuer does not start with G (secret key prefix)", async () => {
    const badIssuer = "SAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
    const res = await request(app).get(`/asset/USDC/${badIssuer}`);
    expectInvalidAsset(res);
    expect(res.body.error.message).toMatch(/not a valid Stellar public key/i);
    expect(res.body.error.suggestion).toMatch(/Ed25519/i);
  });

  it("returns 400 InvalidAsset when issuer is a random non-key string", async () => {
    const badIssuer = "notanaddress";
    const res = await request(app).get(`/asset/USDC/${badIssuer}`);
    expectInvalidAsset(res);
    expect(res.body.error.type).toBe("InvalidAsset");
    expect(res.body.error.message).toMatch(/not a valid Stellar public key/i);
  });

  it("returns 400 InvalidAsset when issuer is too short", async () => {
    const shortIssuer = "GABC123";
    const res = await request(app).get(`/asset/USDC/${shortIssuer}`);
    expectInvalidAsset(res);
    expect(res.body.error.type).toBe("InvalidAsset");
  });

  it("passes validation for a valid code and issuer (does NOT return InvalidAsset)", async () => {
    const res = await request(app).get(`/asset/USDC/${VALID_ISSUER}`);
    expect(res.statusCode).not.toBe(400);
    expect(res.body.error?.type).not.toBe("InvalidAsset");
  });

  // /asset/:code/:issuer/holders
  it("returns 400 InvalidAsset on /holders when code is too long", async () => {
    const longCode = "WAYTOOLONGCODE"; // 14 chars
    const res = await request(app).get(`/asset/${longCode}/${VALID_ISSUER}/holders`);
    expectInvalidAsset(res);
    expect(res.body.error.message).toMatch(/too long/i);
  });

  it("returns 400 InvalidAsset on /holders when issuer is invalid", async () => {
    const res = await request(app).get(`/asset/USDC/INVALIDISSUER/holders`);
    expectInvalidAsset(res);
    expect(res.body.error.type).toBe("InvalidAsset");
  });

  // /asset/:code/:issuer/distribution
  it("returns 400 InvalidAsset on /distribution when code is too long", async () => {
    const longCode = "TOOLONGASSETCD"; // 14 chars
    const res = await request(app).get(`/asset/${longCode}/${VALID_ISSUER}/distribution`);
    expectInvalidAsset(res);
  });

  it("returns 400 InvalidAsset on /distribution when issuer is invalid", async () => {
    const res = await request(app).get(`/asset/USDC/BAADISSUER/distribution`);
    expectInvalidAsset(res);
    expect(res.body.error.type).toBe("InvalidAsset");
  });

  // /asset/:code/:issuer/supply
  it("returns 400 InvalidAsset on /supply when code is too long", async () => {
    const longCode = "TOOLONGASSETCO"; // 14 chars
    const res = await request(app).get(`/asset/${longCode}/${VALID_ISSUER}/supply`);
    expectInvalidAsset(res);
  });

  it("returns 400 InvalidAsset on /supply when issuer is invalid", async () => {
    const res = await request(app).get(`/asset/USDC/NOTAVALIDISSUER/supply`);
    expectInvalidAsset(res);
    expect(res.body.error.type).toBe("InvalidAsset");
  });

  // /asset/:code/:issuer/verify
  it("returns 400 InvalidAsset on /verify when code is too long", async () => {
    const longCode = "TOOLONGASSETCOD"; // 15 chars
    const res = await request(app).get(`/asset/${longCode}/${VALID_ISSUER}/verify`);
    expectInvalidAsset(res);
  });

  it("returns 400 InvalidAsset on /verify when issuer is invalid", async () => {
    const res = await request(app).get(`/asset/USDC/INVALID_ISSUER/verify`);
    expectInvalidAsset(res);
    expect(res.body.error.type).toBe("InvalidAsset");
  });
});

// Unit tests for validateAsset directly
describe("validateAsset() unit tests", () => {
  const { validateAsset } = require("../src/utils/validators");

  it("does not throw for a valid code and issuer", () => {
    expect(() => validateAsset("USDC", VALID_ISSUER)).not.toThrow();
  });

  it("throws with isInvalidAsset=true when code is missing", () => {
    let caught;
    try { validateAsset("", VALID_ISSUER); } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.isInvalidAsset).toBe(true);
    expect(caught.message).toMatch(/code is required/i);
    expect(caught.suggestion).toBeTruthy();
  });

  it("throws with isInvalidAsset=true when code exceeds 12 characters", () => {
    let caught;
    try { validateAsset("ABCDEFGHIJKLM", VALID_ISSUER); } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.isInvalidAsset).toBe(true);
    expect(caught.message).toMatch(/too long/i);
  });

  it("throws with isInvalidAsset=true when code has invalid characters", () => {
    let caught;
    try { validateAsset("US$C", VALID_ISSUER); } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.isInvalidAsset).toBe(true);
    expect(caught.message).toMatch(/invalid character/i);
  });

  it("throws with isInvalidAsset=true when issuer is missing", () => {
    let caught;
    try { validateAsset("USDC", ""); } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.isInvalidAsset).toBe(true);
    expect(caught.message).toMatch(/issuer is required/i);
  });

  it("throws with isInvalidAsset=true when issuer is not a valid Stellar public key", () => {
    let caught;
    try { validateAsset("USDC", "NOTAVALIDKEY"); } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.isInvalidAsset).toBe(true);
    expect(caught.message).toMatch(/not a valid Stellar public key/i);
    expect(caught.suggestion).toMatch(/Ed25519/i);
  });

  it("throws with isInvalidAsset=true when issuer is a secret key (starts with S)", () => {
    const secretKey = "SAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
    let caught;
    try { validateAsset("USDC", secretKey); } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.isInvalidAsset).toBe(true);
  });
});
