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
