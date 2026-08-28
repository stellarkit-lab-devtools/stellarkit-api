const request = require("supertest");
const app = require("../src/index");
const { horizonUrl } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

const originalFetch = global.fetch;

const HORIZON_METADATA = {
  current_protocol_version: 23,
  network_passphrase: "Test SDF Network ; September 2015",
  horizon_version: "2.33.0",
};

function mockHorizonMetadata(metadata = HORIZON_METADATA) {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(metadata),
  });
}

describe("GET /network/protocol-version", () => {
  beforeEach(() => {
    cacheService.flush();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    cacheService.flush();
    global.fetch = originalFetch;
  });

  it("returns the current protocol, network passphrase, and Horizon version", async () => {
    mockHorizonMetadata();

    const response = await request(app).get("/network/protocol-version");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        protocolVersion: 23,
        networkPassphrase: "Test SDF Network ; September 2015",
        horizonVersion: "2.33.0",
      },
    });
    expect(response.get("X-Cache")).toBe("MISS");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(horizonUrl);
  });

  it("serves repeated requests from the 60-second cache", async () => {
    mockHorizonMetadata();

    await request(app).get("/network/protocol-version");
    const cachedResponse = await request(app).get("/network/protocol-version");

    expect(cachedResponse.statusCode).toBe(200);
    expect(cachedResponse.get("X-Cache")).toBe("HIT");
    expect(cachedResponse.body.data).toEqual({
      protocolVersion: 23,
      networkPassphrase: "Test SDF Network ; September 2015",
      horizonVersion: "2.33.0",
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("fetches fresh metadata after the 60-second cache expires", async () => {
    let now = Date.parse("2026-07-29T22:00:00Z");
    jest.spyOn(Date, "now").mockImplementation(() => now);
    mockHorizonMetadata();

    await request(app).get("/network/protocol-version");

    now += 60_001;
    mockHorizonMetadata({
      ...HORIZON_METADATA,
      current_protocol_version: 24,
    });

    const refreshedResponse = await request(app).get("/network/protocol-version");

    expect(refreshedResponse.statusCode).toBe(200);
    expect(refreshedResponse.get("X-Cache")).toBe("MISS");
    expect(refreshedResponse.body.data.protocolVersion).toBe(24);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns a clean error when Horizon is unreachable", async () => {
    const connectionError = new Error("fetch failed");
    connectionError.cause = { code: "ECONNREFUSED" };
    global.fetch.mockRejectedValue(connectionError);

    const response = await request(app).get("/network/protocol-version");

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: {
        type: "HorizonUnavailable",
        message: "Unable to connect to the Stellar Horizon node.",
        suggestion:
          "Check your HORIZON_URL and verify the node is reachable. See https://status.stellar.org for network status.",
      },
      requestId: expect.any(String),
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
