const request = require("supertest");
const app = require("../src/index");

describe("GET /utils/keypair", () => {
  const originalNetwork = process.env.STELLAR_NETWORK;

  afterEach(() => {
    process.env.STELLAR_NETWORK = originalNetwork;
  });

  it("returns a valid keypair on testnet", async () => {
    process.env.STELLAR_NETWORK = "testnet";
    const res = await request(app).get("/utils/keypair");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
    expect(res.body.data.secretKey).toMatch(/^S[A-Z2-7]{55}$/);
    expect(res.body.data.warning).toBe("Never share your secret key");
  });

  it("returns a different keypair on each call", async () => {
    process.env.STELLAR_NETWORK = "testnet";
    const res1 = await request(app).get("/utils/keypair");
    const res2 = await request(app).get("/utils/keypair");
    expect(res1.body.data.publicKey).not.toBe(res2.body.data.publicKey);
    expect(res1.body.data.secretKey).not.toBe(res2.body.data.secretKey);
  });

  it("returns 403 on mainnet", async () => {
    process.env.STELLAR_NETWORK = "mainnet";
    const res = await request(app).get("/utils/keypair");
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });
});
