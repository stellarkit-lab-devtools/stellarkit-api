const request = require("supertest");

function loadFreshApp() {
  jest.resetModules();
  const app = require("../src/index");
  const { server } = require("../src/config/stellar");
  return { app, server };
}

describe("Pretty JSON (?pretty=true)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns compact JSON by default", async () => {
    const { app, server } = loadFreshApp();
    jest.spyOn(server, "serverInfo").mockResolvedValue({ horizon_version: "2.33.0" });

    const res = await request(app).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.text).not.toContain("\n  ");
  });

  it("returns indented JSON with ?pretty=true for success responses", async () => {
    const { app, server } = loadFreshApp();
    jest.spyOn(server, "serverInfo").mockResolvedValue({ horizon_version: "2.33.0" });

    const res = await request(app).get("/?pretty=true");
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("\n  ");
    // Verify it's valid JSON with 2-space indentation
    const parsed = JSON.parse(res.text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.name).toBe("StellarKit API");
  });

  it("returns indented JSON with ?pretty=true for error responses", async () => {
    const { app } = loadFreshApp();

    const res = await request(app).get("/nonexistent-route?pretty=true");
    expect(res.statusCode).toBe(404);
    expect(res.text).toContain("\n  ");
    const parsed = JSON.parse(res.text);
    expect(parsed.success).toBe(false);
    expect(parsed.error.type).toBe("NotFound");
  });

  it("returns compact JSON for any other pretty value", async () => {
    const { app, server } = loadFreshApp();
    jest.spyOn(server, "serverInfo").mockResolvedValue({ horizon_version: "2.33.0" });

    const res = await request(app).get("/?pretty=1");
    expect(res.statusCode).toBe(200);
    expect(res.text).not.toContain("\n  ");
  });

  it("does not affect cache key sharing between pretty and compact", async () => {
    const { app, server } = loadFreshApp();
    jest.spyOn(server, "serverInfo").mockResolvedValue({ horizon_version: "2.33.0" });

    // First request with pretty — should get a response
    const res1 = await request(app).get("/?pretty=true");
    expect(res1.statusCode).toBe(200);

    // Second request without pretty — should also get a response
    // The key insight is that "pretty" doesn't appear in the cache key
    // so both requests share the same cache entry
    const res2 = await request(app).get("/");
    expect(res2.statusCode).toBe(200);

    // Both should have the same data content (just different formatting)
    const parsed1 = JSON.parse(res1.text);
    const parsed2 = JSON.parse(res2.text);
    expect(parsed1.data.name).toBe(parsed2.data.name);
  });
});
