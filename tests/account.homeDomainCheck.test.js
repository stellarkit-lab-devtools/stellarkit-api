"use strict";

/**
 * Issue #1174 — GET /account/:id/home-domain-check.
 */

const express = require("express");
const request = require("supertest");
const axios = require("axios");
const { Keypair } = require("@stellar/stellar-sdk");

const ACCOUNT = Keypair.random().publicKey();
const ISSUER_OTHER = Keypair.random().publicKey();

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      loadAccount: jest.fn(),
      payments: jest.fn(),
      trades: jest.fn(),
      operations: jest.fn(),
      ledgers: jest.fn(),
      feeStats: jest.fn(),
    },
  };
});

const { server } = require("../src/config/stellar");
const accountRouter = require("../src/routes/account");
const cacheService = require("../src/services/cache");
const errorHandler = require("../src/middleware/errorHandler");

const app = express();
app.use("/account", accountRouter);
app.use(errorHandler);

const TOML_LISTED = `
VERSION="1.0.0"
[[ACCOUNTS]]
name="issuer"
account="${ACCOUNT}"
[[CURRENCIES]]
code="USD"
issuer="${ACCOUNT}"
name="US Dollar"
[[CURRENCIES]]
code="OTHER"
issuer="${ISSUER_OTHER}"
`;

const TOML_NOT_LISTED = `
VERSION="1.0.0"
[[ACCOUNTS]]
name="someone-else"
account="${ISSUER_OTHER}"
[[CURRENCIES]]
code="OTHER"
issuer="${ISSUER_OTHER}"
`;

function accountWithHomeDomain(domain) {
  server.loadAccount.mockResolvedValue({ id: ACCOUNT, home_domain: domain });
}

describe("GET /account/:id/home-domain-check", () => {
  beforeEach(() => {
    cacheService.flush();
    jest.clearAllMocks();
    accountWithHomeDomain("example.com");
  });
  afterEach(() => {
    jest.restoreAllMocks();
    cacheService.flush();
  });

  it("returns listed=true and only this account's currencies", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: TOML_LISTED });

    const res = await request(app).get(`/account/${ACCOUNT}/home-domain-check`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      accountId: ACCOUNT,
      homeDomain: "example.com",
      tomlFound: true,
      accountListedInToml: true,
      reason: null,
    }));
    expect(res.body.data.currencies).toHaveLength(1);
    expect(res.body.data.currencies[0].code).toBe("USD");
    expect(res.body.data.currencies[0].asset).toEqual({
      code: "USD", issuer: ACCOUNT, type: "credit_alphanum4",
    });
    expect(new Date(res.body.data.checkedAt).toISOString()).toBe(res.body.data.checkedAt);
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("returns tomlFound=true but listed=false when the TOML lists another account", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: TOML_NOT_LISTED });

    const res = await request(app).get(`/account/${ACCOUNT}/home-domain-check`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tomlFound).toBe(true);
    expect(res.body.data.accountListedInToml).toBe(false);
    expect(res.body.data.currencies).toHaveLength(0);
    expect(res.body.data.reason).toBe("account_not_listed");
  });

  it("reports no_home_domain without fetching a TOML", async () => {
    accountWithHomeDomain(null);
    const get = jest.spyOn(axios, "get").mockResolvedValue({ data: TOML_LISTED });

    const res = await request(app).get(`/account/${ACCOUNT}/home-domain-check`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tomlFound).toBe(false);
    expect(res.body.data.reason).toBe("no_home_domain");
    expect(get).not.toHaveBeenCalled();
  });

  it("reports toml_unreachable rather than a 500", async () => {
    jest.spyOn(axios, "get").mockRejectedValue(new Error("ENOTFOUND"));

    const res = await request(app).get(`/account/${ACCOUNT}/home-domain-check`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tomlFound).toBe(false);
    expect(res.body.data.reason).toBe("toml_unreachable");
  });

  it("reports toml_invalid for malformed TOML rather than a 500", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: "{{ this is not toml" });

    const res = await request(app).get(`/account/${ACCOUNT}/home-domain-check`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tomlFound).toBe(false);
    expect(res.body.data.reason).toBe("toml_invalid");
  });

  it("caches successful results for five minutes", async () => {
    const get = jest.spyOn(axios, "get").mockResolvedValue({ data: TOML_LISTED });

    const first = await request(app).get(`/account/${ACCOUNT}/home-domain-check`);
    const second = await request(app).get(`/account/${ACCOUNT}/home-domain-check`);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.body.data).toEqual(first.body.data);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for an unknown account", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404, data: {} } });

    const res = await request(app).get(`/account/${ACCOUNT}/home-domain-check`);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
