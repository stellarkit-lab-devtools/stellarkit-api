const request = require("supertest");
const app = require("../src/index");

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
