const request = require("supertest");
const express = require("express");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => ({
  server: { {{MOCK}} },
}));

const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");
const router = require("../../src/routes/{{NAME}}");
const errorHandler = require("../../src/middleware/errorHandler");
const accountId = Keypair.random().publicKey();
const url = {{TEST_URL}}.replace("${accountId}", accountId);
const app = express();
app.use(router);
app.use(errorHandler);

describe("{{NAME}} route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
{{SETUP}}
  });

  it("returns the standard success envelope", async () => {
    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({{EXPECT_DATA}});
{{EXPECT_EXTRA}}{{CACHE_TEST}}  });
});
