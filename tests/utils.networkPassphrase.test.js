const request = require("supertest");
const { Networks } = require("@stellar/stellar-sdk");
const app = require("../src/index");

describe("GET /utils/network-passphrase", () => {
  const originalNetwork = process.env.STELLAR_NETWORK;

  afterEach(() => {
    process.env.STELLAR_NETWORK = originalNetwork;
  });

  it("returns the testnet passphrase when STELLAR_NETWORK=testnet", async () => {
    process.env.STELLAR_NETWORK = "testnet";
    const res = await request(app).get("/utils/network-passphrase");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      network: "testnet",
      passphrase: Networks.TESTNET,
    });
  });

  it("returns the mainnet (public) passphrase when STELLAR_NETWORK=mainnet", async () => {
    process.env.STELLAR_NETWORK = "mainnet";
    const res = await request(app).get("/utils/network-passphrase");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      network: "mainnet",
      passphrase: Networks.PUBLIC,
    });
  });

  it("defaults to the testnet passphrase when STELLAR_NETWORK is unset", async () => {
    delete process.env.STELLAR_NETWORK;
    const res = await request(app).get("/utils/network-passphrase");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      network: "testnet",
      passphrase: Networks.TESTNET,
    });
  });
});
