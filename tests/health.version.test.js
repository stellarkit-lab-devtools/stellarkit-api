"use strict";

/**
 * GET /health — version field integrity (Issue #865).
 *
 * Verifies that the health endpoint reads `version` dynamically from
 * package.json rather than returning a hardcoded string. This prevents the
 * health response from going stale after a release bump.
 */

const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const pkg = require("../package.json");

function mockHealthyHorizon() {
  jest.spyOn(server, "serverInfo").mockResolvedValue({
    horizon_version: "22.0.1",
    core_version: "stellar-core 21.0.0",
    network_passphrase: "Test SDF Network ; September 2015",
  });
}

describe("GET /health — version field", () => {
  beforeEach(() => {
    mockHealthyHorizon();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns a version field in the health response", async () => {
    const res = await request(app).get("/health");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.version).toBeDefined();
  });

  it("version field matches the version in package.json", async () => {
    const res = await request(app).get("/health");

    expect(res.body.data.version).toBe(pkg.version);
  });

  it("version field is a non-empty string", async () => {
    const res = await request(app).get("/health");
    const { version } = res.body.data;

    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });

  it("version field follows semver format (x.y.z)", async () => {
    const res = await request(app).get("/health");
    const { version } = res.body.data;

    // Basic semver check — e.g. "1.0.0", "2.3.14"
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
