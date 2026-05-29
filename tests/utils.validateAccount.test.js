const request = require("supertest");
const app = require("../src/index");

// A real, well-formed Stellar testnet public key used across tests.
const VALID_KEY = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("GET /utils/validate-account", () => {
  it("returns isValid: true with reason: null for a valid public key", async () => {
    const res = await request(app).get(
      `/utils/validate-account?id=${VALID_KEY}`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      input: VALID_KEY,
      isValid: true,
      reason: null,
    });
  });

  it("returns isValid: false with a reason when the key has a wrong prefix", async () => {
    // Replace leading 'G' with 'S' (a valid StrKey prefix for secret keys, wrong for public keys)
    const wrongPrefix =
      "SAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
    const res = await request(app).get(
      `/utils/validate-account?id=${wrongPrefix}`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.input).toBe(wrongPrefix);
    expect(res.body.data.isValid).toBe(false);
    expect(res.body.data.reason).toMatch(/prefix/i);
  });

  it("returns isValid: false with a reason when the key is too short", async () => {
    const tooShort = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVK"; // < 56 chars
    const res = await request(app).get(
      `/utils/validate-account?id=${tooShort}`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.input).toBe(tooShort);
    expect(res.body.data.isValid).toBe(false);
    expect(res.body.data.reason).toMatch(/length/i);
  });

  it("returns isValid: false with a reason when the key contains invalid characters", async () => {
    // Replace a valid base32 char with '0' (not in base32 alphabet A-Z, 2-7)
    const invalidChars =
      "G0AZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
    const res = await request(app).get(
      `/utils/validate-account?id=${invalidChars}`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.input).toBe(invalidChars);
    expect(res.body.data.isValid).toBe(false);
    expect(res.body.data.reason).toMatch(/character/i);
  });

  it("returns 400 when the id parameter is missing", async () => {
    const res = await request(app).get("/utils/validate-account");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.message).toMatch(/'id'/);
  });

  it("returns 400 when the id parameter is an empty string", async () => {
    const res = await request(app).get("/utils/validate-account?id=");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.message).toMatch(/'id'/);
  });
});
