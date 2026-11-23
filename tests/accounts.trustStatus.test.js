const request = require("supertest");

jest.mock("../src/config/stellar", () => ({
  server: {
    loadAccount: jest.fn(),
  },
  horizonUrl: "https://horizon-testnet.stellar.org",
  NETWORK: "testnet",
  NETWORKS: {
    testnet: "https://horizon-testnet.stellar.org",
    mainnet: "https://horizon.stellar.org",
  },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");

describe("POST /accounts/trust-status", () => {
  const ACCOUNT_1 = "GBRPYHIL2CI3WHZSRXYE5Q6MKDA77BNUCQVLLELYVT2QX3BZ4TSNOTF";
  const ACCOUNT_2 = "GBCBQ7TWZXGM7JGVNFK4RYNRYDPN5KHCADM4PQN2CV7NJFPUGZMHQJV";
  const NONEXISTENT_ACCOUNT = "GCZST3XVCDTUJ76ZAV2HA72KYEV5QJ5PCIPNPLGKLPTK3AAEB23X2O5";
  const ISSUER = "GBHSJZQQOASDCJMMK4J3K7S4KCTGP72QJVVJ4RXNZ7TXPZ6RCK5BLYD";
  const USDC_CODE = "USDC";
  const BTC_CODE = "BTC";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Validation", () => {
    it("returns 400 if addresses is missing", async () => {
      const res = await request(app)
        .post("/accounts/trust-status")
        .send({
          asset: { code: USDC_CODE, issuer: ISSUER },
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 if addresses is not an array", async () => {
      const res = await request(app)
        .post("/accounts/trust-status")
        .send({
          addresses: ACCOUNT_1,
          asset: { code: USDC_CODE, issuer: ISSUER },
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 if addresses array is empty", async () => {
      const res = await request(app)
        .post("/accounts/trust-status")
        .send({
          addresses: [],
          asset: { code: USDC_CODE, issuer: ISSUER },
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("At least one address");
    });

    it("returns 400 if addresses exceed 30", async () => {
      const addresses = Array(31)
        .fill(null)
        .map((_, i) =>
          `${"G"}${String(i).padStart(55, "A")}`
        );

      const res = await request(app)
        .post("/accounts/trust-status")
        .send({
          addresses,
          asset: { code: USDC_CODE, issuer: ISSUER },
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("Maximum of 30 addresses");
    });

    it("returns 400 if address is not a string", async () => {
      const res = await request(app)
        .post("/accounts/trust-status")
        .send({
          addresses: [ACCOUNT_1, 123],
          asset: { code: USDC_CODE, issuer: ISSUER },
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 if address is invalid format", async () => {
      const res = await request(app)
        .post("/accounts/trust-status")
        .send({
          addresses: [ACCOUNT_1, "invalid-account"],
          asset: { code: USDC_CODE, issuer: ISSUER },
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 if asset is missing", async () => {
      const res = await request(app)
        .post("/accounts/trust-status")
        .send({
          addresses: [ACCOUNT_1],
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 if asset code is missing", async () => {
      const res = await request(app)
        .post("/accounts/trust-status")
        .send({
          addresses: [ACCOUNT_1],
          asset: { issuer: ISSUER },
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 if asset issuer is missing", async () => {
      const res = await request(app)
        .post("/accounts/trust-status")
        .send({
          addresses: [ACCOUNT_1],
          asset: { code: USDC_CODE },
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 if asset code is invalid", async () => {
      const res = await request(app)
        .post("/accounts/trust-status")
        .send({
          addresses: [ACCOUNT_1],
          asset: { code: "INVALID_ASSET_CODE_TOO_LONG", issuer: ISSUER },
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 if asset issuer is invalid", async () => {
      const res = await request(app)
        .post("/accounts/trust-status")
        .send({
          addresses: [ACCOUNT_1],
          asset: { code: USDC_CODE, issuer: "invalid-issuer" },
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
    });
  });

});

