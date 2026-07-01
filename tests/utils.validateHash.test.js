const request = require("supertest");
const app = require("../src/index");

// A real, well-formed Stellar transaction hash: 64 lowercase hex characters.
const VALID_HASH =
  "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889";

describe("GET /utils/validate-hash", () => {
  it("returns isValid: true with reason: null for a valid transaction hash", async () => {
    const res = await request(app).get(`/utils/validate-hash?hash=${VALID_HASH}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      input: VALID_HASH,
      isValid: true,
      reason: null,
    });
  });

  it("returns isValid: false with a reason when the hash is too short", async () => {
    const tooShort = VALID_HASH.slice(0, 63);
    const res = await request(app).get(`/utils/validate-hash?hash=${tooShort}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.input).toBe(tooShort);
    expect(res.body.data.isValid).toBe(false);
    expect(res.body.data.reason).toMatch(/length/i);
  });

  it("returns isValid: false with a reason when the hash is too long", async () => {
    const tooLong = VALID_HASH + "00";
    const res = await request(app).get(`/utils/validate-hash?hash=${tooLong}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.input).toBe(tooLong);
    expect(res.body.data.isValid).toBe(false);
    expect(res.body.data.reason).toMatch(/length/i);
  });

  it("returns isValid: false with a reason when the hash contains non-hex characters", async () => {
    // Replace the last char with 'z' (not a hex digit), keeping length 64.
    const nonHex = VALID_HASH.slice(0, 63) + "z";
    const res = await request(app).get(`/utils/validate-hash?hash=${nonHex}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.input).toBe(nonHex);
    expect(res.body.data.isValid).toBe(false);
    expect(res.body.data.reason).toMatch(/character/i);
  });

  it("returns isValid: false when the hash contains uppercase hex characters", async () => {
    const uppercase = VALID_HASH.toUpperCase();
    const res = await request(app).get(`/utils/validate-hash?hash=${uppercase}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.input).toBe(uppercase);
    expect(res.body.data.isValid).toBe(false);
    expect(res.body.data.reason).toMatch(/character/i);
  });

  it("returns 400 when the hash parameter is missing", async () => {
    const res = await request(app).get("/utils/validate-hash");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.message).toMatch(/'hash'/);
  });

  it("returns 400 when the hash parameter is an empty string", async () => {
    const res = await request(app).get("/utils/validate-hash?hash=");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.message).toMatch(/'hash'/);
  });
});
