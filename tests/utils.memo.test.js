const request = require("supertest");
const app = require("../src/index");

describe("GET /utils/memo", () => {
  it("decodes a text memo (base64) to plain text", async () => {
    const res = await request(app).get("/utils/memo?type=text&value=SGVsbG8=");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      type: "text",
      raw: "SGVsbG8=",
      decoded: "Hello",
      description: "Plain text memo",
    });
  });

  it("returns none memo as null decoded", async () => {
    const res = await request(app).get("/utils/memo?type=none");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      type: "none",
      raw: null,
      decoded: null,
      description: "No memo attached to the transaction.",
    });
  });

  it("decodes a hash memo (base64) to hex", async () => {
    // bytes: 0x01 0x02 0x03 -> base64 AQID
    const res = await request(app).get("/utils/memo?type=hash&value=AQID");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      type: "hash",
      raw: "AQID",
      decoded: "010203",
      description: "32-byte hash memo (hex) commonly used for transaction references",
    });
  });

  it("returns 400 for unsupported memo types", async () => {
    const res = await request(app).get("/utils/memo?type=unsupported&value=abc");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toHaveProperty("type");
  });
});

describe("POST /utils/validate-memo", () => {
  it("validates text memos by UTF-8 byte length", async () => {
    const valid = await request(app)
      .post("/utils/validate-memo")
      .send({ type: "text", value: "Stellar memo" });
    expect(valid.statusCode).toBe(200);
    expect(valid.body.data).toEqual({
      valid: true,
      type: "text",
      value: "Stellar memo",
      byteLength: 12,
      error: null,
      errors: [],
    });

    const tooLong = await request(app)
      .post("/utils/validate-memo")
      .send({ type: "text", value: "é".repeat(15) });
    expect(tooLong.body.data.valid).toBe(false);
    expect(tooLong.body.data.byteLength).toBe(30);
    expect(tooLong.body.data.errors[0]).toContain("28-byte limit");
  });

  it("validates ID memos as unsigned 64-bit integers", async () => {
    const valid = await request(app)
      .post("/utils/validate-memo")
      .send({ type: "id", value: "18446744073709551615" });
    expect(valid.body.data).toEqual({
      valid: true,
      type: "id",
      value: "18446744073709551615",
      byteLength: 8,
      error: null,
      errors: [],
    });

    const invalid = await request(app)
      .post("/utils/validate-memo")
      .send({ type: "id", value: "18446744073709551616" });
    expect(invalid.body.data.valid).toBe(false);
    expect(invalid.body.data.errors[0]).toContain("unsigned 64-bit integer range");
  });

  it.each(["hash", "return"])("validates %s memos as exactly 32 bytes", async (type) => {
    const valid = await request(app)
      .post("/utils/validate-memo")
      .send({ type, value: "ab".repeat(32) });
    expect(valid.body.data).toEqual({
      valid: true,
      type,
      value: "ab".repeat(32),
      byteLength: 32,
      error: null,
      errors: [],
    });

    const invalid = await request(app)
      .post("/utils/validate-memo")
      .send({ type, value: "ab".repeat(31) });
    expect(invalid.body.data.valid).toBe(false);
    expect(invalid.body.data.byteLength).toBe(31);
    expect(invalid.body.data.errors[0]).toContain("exactly 32 bytes");
  });
});
