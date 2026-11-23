const request = require("supertest");
const express = require("express");
const utilsRouter = require("../../src/routes/utils");
const { success } = require("../../src/utils/response");

// Mock response helper
jest.mock("../../src/utils/response", () => ({
  success: jest.fn((res, data) => res.json({ success: true, data })),
}));

// Mock stellar config
jest.mock("../../src/config/stellar", () => ({
  server: {
    ledgers: jest.fn(() => ({
      order: jest.fn(() => ({
        limit: jest.fn(() => ({
          call: jest.fn().mockResolvedValue({
            records: [
              {
                sequence: 50000000,
                closed_at: "2024-01-01T00:00:00Z",
              },
            ],
          }),
        })),
      })),
    })),
  },
}));

describe("GET /utils/asset-contract-id", () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use("/utils", utilsRouter);
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        success: false,
        error: err.message,
      });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return contract ID for native XLM on testnet", async () => {
    process.env.STELLAR_NETWORK = "testnet";

    const response = await request(app).get("/utils/asset-contract-id?asset=XLM");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("asset", "XLM");
    expect(response.body.data).toHaveProperty("contractId");
    expect(response.body.data).toHaveProperty("network", "testnet");
    expect(response.body.data).toHaveProperty("networkPassphrase");
    expect(response.body.data.contractId).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it("should return contract ID for native XLM on mainnet", async () => {
    process.env.STELLAR_NETWORK = "mainnet";

    const response = await request(app).get("/utils/asset-contract-id?asset=XLM");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("asset", "XLM");
    expect(response.body.data).toHaveProperty("network", "mainnet");
    expect(response.body.data.contractId).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it("should return different contract IDs for testnet vs mainnet", async () => {
    const testnetResponse = await request(app).get(
      "/utils/asset-contract-id?asset=XLM&network=testnet"
    );
    const mainnetResponse = await request(app).get(
      "/utils/asset-contract-id?asset=XLM&network=mainnet"
    );

    expect(testnetResponse.status).toBe(200);
    expect(mainnetResponse.status).toBe(200);

    const testnetId = testnetResponse.body.data.contractId;
    const mainnetId = mainnetResponse.body.data.contractId;

    expect(testnetId).not.toBe(mainnetId);
  });

  it("should return contract ID for credit asset", async () => {
    process.env.STELLAR_NETWORK = "testnet";
    const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    const response = await request(app).get(
      `/utils/asset-contract-id?asset=USDC:${issuer}`
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("asset", `USDC:${issuer}`);
    expect(response.body.data).toHaveProperty("contractId");
    expect(response.body.data.contractId).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it("should accept network override parameter", async () => {
    process.env.STELLAR_NETWORK = "testnet";

    const response = await request(app).get(
      "/utils/asset-contract-id?asset=XLM&network=mainnet"
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveProperty("network", "mainnet");
    expect(response.body.data.networkPassphrase).toContain("Public");
  });

  it("should reject request without asset parameter", async () => {
    const response = await request(app).get("/utils/asset-contract-id");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/asset.*required/i);
  });

  it("should reject empty asset parameter", async () => {
    const response = await request(app).get("/utils/asset-contract-id?asset=");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/asset.*required/i);
  });

  it("should reject invalid asset format", async () => {
    const response = await request(app).get("/utils/asset-contract-id?asset=USDC");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/Invalid asset format/i);
  });

  it("should reject asset with overlong code", async () => {
    const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    const response = await request(app).get(
      `/utils/asset-contract-id?asset=TOOLONGASSETCODE:${issuer}`
    );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/Invalid asset code/i);
  });

  it("should reject asset with invalid issuer", async () => {
    const response = await request(app).get(
      "/utils/asset-contract-id?asset=USDC:INVALID"
    );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/Invalid issuer address/i);
  });

  it("should reject asset with malformed issuer", async () => {
    const response = await request(app).get(
      "/utils/asset-contract-id?asset=USDC:XAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"
    );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/Invalid issuer address/i);
  });

  it("should reject unknown network parameter", async () => {
    const response = await request(app).get(
      "/utils/asset-contract-id?asset=XLM&network=unknown"
    );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/Unknown network/i);
  });

  it("should handle asset codes with different lengths", async () => {
    const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    
    // 1 character
    const resp1 = await request(app).get(`/utils/asset-contract-id?asset=A:${issuer}`);
    expect(resp1.status).toBe(200);

    // 4 characters
    const resp4 = await request(app).get(`/utils/asset-contract-id?asset=USDC:${issuer}`);
    expect(resp4.status).toBe(200);

    // 12 characters (max)
    const resp12 = await request(app).get(`/utils/asset-contract-id?asset=LONGASSET123:${issuer}`);
    expect(resp12.status).toBe(200);
  });

  it("should be case-insensitive for XLM", async () => {
    const responses = await Promise.all([
      request(app).get("/utils/asset-contract-id?asset=XLM"),
      request(app).get("/utils/asset-contract-id?asset=xlm"),
      request(app).get("/utils/asset-contract-id?asset=Xlm"),
    ]);

    responses.forEach((response) => {
      expect(response.status).toBe(200);
      expect(response.body.data.asset).toBe("XLM");
    });

    // All should return same contract ID
    const contractIds = responses.map((r) => r.body.data.contractId);
    expect(contractIds[0]).toBe(contractIds[1]);
    expect(contractIds[0]).toBe(contractIds[2]);
  });
});
