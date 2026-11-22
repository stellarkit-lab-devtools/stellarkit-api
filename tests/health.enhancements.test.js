/**
 * Tests for the extended GET /health endpoint.
 *
 * Verifies the three new operational fields:
 *   - uptimeSeconds  — non-negative integer
 *   - nodeVersion    — matches the Node.js version string pattern (e.g. "v20.11.0")
 *   - startedAt      — valid ISO 8601 timestamp
 *
 * Also verifies the build info object added by issue #1197:
 *   - build.commit   — 7-char string when GIT_SHA is set, null otherwise
 *   - build.builtAt  — string when BUILD_TIME is set, null otherwise
 *   - build.nodeEnv  — string
 */

const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

function mockHealthyHorizon() {
  jest.spyOn(server, "serverInfo").mockResolvedValue({
    horizon_version: "2.33.0",
    core_version: "stellar-core 21.0.0",
    network_passphrase: "Test SDF Network ; September 2015",
    core_latest_ledger: 100,
    history_latest_ledger: 100,
  });
}

describe("GET /health — extended fields", () => {
  beforeEach(() => {
    mockHealthyHorizon();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
  it("returns 200 with success: true", async () => {
    const res = await request(app).get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("includes uptimeSeconds as a non-negative integer", async () => {
    const res = await request(app).get("/health");
    const { uptimeSeconds } = res.body.data;

    expect(uptimeSeconds).toBeDefined();
    expect(typeof uptimeSeconds).toBe("number");
    expect(Number.isInteger(uptimeSeconds)).toBe(true);
    expect(uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("includes nodeVersion matching the Node.js version string pattern", async () => {
    const res = await request(app).get("/health");
    const { nodeVersion } = res.body.data;

    expect(nodeVersion).toBeDefined();
    expect(typeof nodeVersion).toBe("string");
    // Must match semver with a leading "v", e.g. "v20.11.0"
    expect(nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
    // Must equal the actual running version
    expect(nodeVersion).toBe(process.version);
  });

  it("includes startedAt as a valid ISO 8601 timestamp", async () => {
    const res = await request(app).get("/health");
    const { startedAt } = res.body.data;

    expect(startedAt).toBeDefined();
    expect(typeof startedAt).toBe("string");

    const parsed = new Date(startedAt);
    expect(Number.isNaN(parsed.getTime())).toBe(false);

    // startedAt must be in the past (not a future timestamp)
    expect(parsed.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("returns startedAt that is earlier than or equal to timestamp", async () => {
    const res = await request(app).get("/health");
    const { startedAt, timestamp } = res.body.data;

    expect(new Date(startedAt).getTime()).toBeLessThanOrEqual(
      new Date(timestamp).getTime(),
    );
  });

  it("still includes all existing fields", async () => {
    const res = await request(app).get("/health");
    const { data } = res.body;

    expect(data.status).toBe("ok");
    expect(data.service).toBe("StellarKit API");
    expect(typeof data.version).toBe("string");
    expect(typeof data.timestamp).toBe("string");
    expect(["testnet", "mainnet"]).toContain(data.network);
  });

  // ── build info (issue #1197) ───────────────────────────────────────────────

  it("includes a build object with commit, builtAt, and nodeEnv", async () => {
    const res = await request(app).get("/health");
    const { build } = res.body.data;

    expect(build).toBeDefined();
    expect(typeof build).toBe("object");
    expect(Object.prototype.hasOwnProperty.call(build, "commit")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(build, "builtAt")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(build, "nodeEnv")).toBe(true);
  });

  it("build.commit is null when GIT_SHA is not set", async () => {
    const original = process.env.GIT_SHA;
    delete process.env.GIT_SHA;

    const res = await request(app).get("/health");
    expect(res.body.data.build.commit).toBeNull();

    if (original !== undefined) process.env.GIT_SHA = original;
  });

  it("build.commit is shortened to 7 characters when GIT_SHA is set", async () => {
    const original = process.env.GIT_SHA;
    process.env.GIT_SHA = "abc1234def5678901234567890";

    const res = await request(app).get("/health");
    expect(res.body.data.build.commit).toBe("abc1234");

    if (original !== undefined) process.env.GIT_SHA = original;
    else delete process.env.GIT_SHA;
  });

  it("build.builtAt is null when BUILD_TIME is not set", async () => {
    const original = process.env.BUILD_TIME;
    delete process.env.BUILD_TIME;

    const res = await request(app).get("/health");
    expect(res.body.data.build.builtAt).toBeNull();

    if (original !== undefined) process.env.BUILD_TIME = original;
  });

  it("build.nodeEnv reflects NODE_ENV", async () => {
    const res = await request(app).get("/health");
    const expected = process.env.NODE_ENV || "development";
    expect(res.body.data.build.nodeEnv).toBe(expected);
  });
});
