"use strict";

/**
 * Tests for POST /accounts/signers
 *
 * Covers:
 *   - Success payload keyed by address with signers, masterWeight, thresholds
 *   - Non-existent accounts return an error entry for that address
 *   - More than 20 addresses returns 400
 *   - Mixed existing / missing accounts in one request
 */

const request = require("supertest");
const express = require("express");
const { Keypair } = require("@stellar/stellar-sdk");

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

const accountsRouter = require("../src/routes/accounts");
const errorHandler = require("../src/middleware/errorHandler");
const { server } = require("../src/config/stellar");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/accounts", accountsRouter);
  app.use(errorHandler);
  return app;
}

const ACCOUNT_1 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ACCOUNT_2 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const MISSING_ACCOUNT = Keypair.random().publicKey();

function makeAccount(id, overrides = {}) {
  return {
    id,
    signers: overrides.signers ?? [
      { key: id, weight: 1, type: "ed25519_public_key" },
    ],
    thresholds: overrides.thresholds ?? {
      low_threshold: 0,
      med_threshold: 0,
      high_threshold: 0,
    },
    master_weight: overrides.master_weight,
  };
}

function notFoundError() {
  const err = new Error("Not Found");
  err.response = { status: 404, data: { status: 404, title: "Resource Missing" } };
  return err;
}

describe("POST /accounts/signers", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns signers, masterWeight, and thresholds keyed by address", async () => {
    const extraSigner = Keypair.random().publicKey();
    server.loadAccount.mockImplementation(async (id) => {
      if (id === ACCOUNT_1) {
        return makeAccount(ACCOUNT_1, {
          signers: [
            { key: ACCOUNT_1, weight: 1, type: "ed25519_public_key" },
            { key: extraSigner, weight: 2, type: "ed25519_public_key" },
          ],
          thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
        });
      }
      return makeAccount(ACCOUNT_2);
    });

    const res = await request(app)
      .post("/accounts/signers")
      .send({ addresses: [ACCOUNT_1, ACCOUNT_2] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.results).toHaveProperty(ACCOUNT_1);
    expect(res.body.data.results).toHaveProperty(ACCOUNT_2);

    const first = res.body.data.results[ACCOUNT_1];
    expect(first.signers).toHaveLength(2);
    expect(first.signers[0]).toMatchObject({ key: ACCOUNT_1, weight: 1, type: "ed25519_public_key" });
    expect(first.masterWeight).toBe(1);
    expect(first.thresholds).toEqual({ low: 1, medium: 2, high: 3 });

    const second = res.body.data.results[ACCOUNT_2];
    expect(second.signers).toHaveLength(1);
    expect(second.masterWeight).toBe(1);
    expect(second.thresholds).toEqual({ low: 0, medium: 0, high: 0 });
  });

  it("returns an error entry for a non-existent account instead of failing the batch", async () => {
    server.loadAccount.mockImplementation(async (id) => {
      if (id === MISSING_ACCOUNT) {
        throw notFoundError();
      }
      return makeAccount(id);
    });

    const res = await request(app)
      .post("/accounts/signers")
      .send({ addresses: [ACCOUNT_1, MISSING_ACCOUNT] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.results[ACCOUNT_1]).toMatchObject({
      signers: expect.any(Array),
      masterWeight: 1,
      thresholds: expect.any(Object),
    });
    expect(res.body.data.results[MISSING_ACCOUNT]).toEqual({
      error: {
        type: "AccountNotFound",
        message: `Account ${MISSING_ACCOUNT} was not found on the Stellar testnet network.`,
      },
    });
  });

  it("returns 400 when more than 20 addresses are provided", async () => {
    const addresses = Array.from({ length: 21 }, () => Keypair.random().publicKey());

    const res = await request(app)
      .post("/accounts/signers")
      .send({ addresses });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.message).toContain("Maximum of 20 addresses");
    expect(server.loadAccount).not.toHaveBeenCalled();
  });

  it("accepts exactly 20 addresses", async () => {
    const addresses = Array.from({ length: 20 }, () => Keypair.random().publicKey());
    server.loadAccount.mockImplementation(async (id) => makeAccount(id));

    const res = await request(app)
      .post("/accounts/signers")
      .send({ addresses });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body.data.results)).toHaveLength(20);
    expect(server.loadAccount).toHaveBeenCalledTimes(20);
  });

  it("returns 400 when addresses is missing", async () => {
    const res = await request(app).post("/accounts/signers").send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 when addresses is not an array", async () => {
    const res = await request(app)
      .post("/accounts/signers")
      .send({ addresses: ACCOUNT_1 });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 when addresses is an empty array", async () => {
    const res = await request(app)
      .post("/accounts/signers")
      .send({ addresses: [] });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
    expect(server.loadAccount).not.toHaveBeenCalled();
  });

  it("returns 400 when an address is not a valid Stellar public key", async () => {
    const res = await request(app)
      .post("/accounts/signers")
      .send({ addresses: [ACCOUNT_1, "not-a-key"] });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
    expect(server.loadAccount).not.toHaveBeenCalled();
  });
});
