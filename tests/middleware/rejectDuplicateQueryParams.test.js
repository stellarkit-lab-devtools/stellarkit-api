const request = require("supertest");
const rejectDuplicateQueryParams = require("../../src/middleware/rejectDuplicateQueryParams");
const app = require("../../src/index");

describe("rejectDuplicateQueryParams middleware", () => {
  it("calls next() when query string has no duplicates", (done) => {
    const req = { originalUrl: "/health?foo=1&bar=2" };
    const res = { status: () => res, json: () => res };
    rejectDuplicateQueryParams(req, res, done);
  });

  it("returns 400 DuplicateParameter for duplicate keys", (done) => {
    const req = { originalUrl: "/health?limit=10&limit=20" };
    const res = {
      status(code) {
        expect(code).toBe(400);
        return this;
      },
      json(body) {
        expect(body).toEqual({
          success: false,
          error: {
            type: "DuplicateParameter",
            message: "Duplicate query parameter detected.",
          },
        });
        done();
      },
    };
    rejectDuplicateQueryParams(req, res, () => done(new Error("next should not run")));
  });
});

describe("Duplicate query parameter rejection (integration)", () => {
  it("rejects duplicate params on /health", async () => {
    const res = await request(app).get("/health?foo=1&foo=2");
    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("DuplicateParameter");
  });

  it("rejects duplicate params on /fee-estimate", async () => {
    const res = await request(app).get("/fee-estimate?operations=1&operations=2");
    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("DuplicateParameter");
  });

  it("rejects duplicate params on /network-status", async () => {
    const res = await request(app).get("/network-status?fresh=true&fresh=false");
    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("DuplicateParameter");
  });

  it("allows unique query parameters", async () => {
    const res = await request(app).get("/health?foo=1&bar=2");
    expect(res.statusCode).toBe(200);
  });
});
