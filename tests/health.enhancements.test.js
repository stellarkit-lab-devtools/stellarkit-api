/**
 * Tests for the extended GET /health endpoint.
 *
 * Verifies the three new operational fields:
 *   - uptimeSeconds  — non-negative integer
 *   - nodeVersion    — matches the Node.js version string pattern (e.g. "v20.11.0")
 *   - startedAt      — valid ISO 8601 timestamp
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
});
