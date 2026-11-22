const express = require("express");
const request = require("supertest");
const requestId = require("../src/middleware/requestId");
const limits = require("../src/middleware/urlLimits");
const errorHandler = require("../src/middleware/errorHandler");

describe("raw URL limits", () => {
  let app;
  const oldUrl = process.env.MAX_URL_LENGTH;
  const oldParams = process.env.MAX_QUERY_PARAMS;
  beforeEach(() => {
    process.env.MAX_URL_LENGTH = "2048";
    process.env.MAX_QUERY_PARAMS = "30";
    app = express();
    app.use(requestId, limits);
    app.use((req, res) => res.json({ success: true }));
    app.use(errorHandler);
  });
  afterAll(() => {
    if (oldUrl === undefined) delete process.env.MAX_URL_LENGTH;
    else process.env.MAX_URL_LENGTH = oldUrl;
    if (oldParams === undefined) delete process.env.MAX_QUERY_PARAMS;
    else process.env.MAX_QUERY_PARAMS = oldParams;
  });
  it("accepts exactly the URL limit", async () => {
    expect((await request(app).get("/" + "a".repeat(2047))).status).toBe(200);
  });
  it("rejects one character over with the standard envelope and request ID", async () => {
    const res = await request(app).get("/" + "a".repeat(2048)).set("X-Request-ID", "url-test");
    expect(res.status).toBe(414);
    expect(res.body).toMatchObject({ success: false, requestId: "url-test", error: { type: "UriTooLong" } });
    expect(res.headers["x-request-id"]).toBe("url-test");
  });
  it("counts repeated raw parameters at the boundary", async () => {
    const url = (count) => "/?" + Array(count).fill("a=1").join("&");
    expect((await request(app).get(url(30))).status).toBe(200);
    const res = await request(app).get(url(31));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, requestId: expect.any(String), error: { type: "TooManyParameters" } });
  });
});
