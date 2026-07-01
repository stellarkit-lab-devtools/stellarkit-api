# Testing Guide

This guide explains how the StellarKit API test suite is structured, how to run it, and how to write new tests that follow the patterns already established in the codebase.

---

## Prerequisites

Install dependencies before running anything:

    npm install

Tests run entirely in-process using mocked Horizon responses. You do not need a live Stellar network or a .env file.

---

## Running the Test Suite

### Run all tests with coverage

    npm test

Jest collects coverage automatically and writes a report to coverage/. Open coverage/lcov-report/index.html in a browser for the full line-by-line breakdown.

### Run a single test file

    npx jest --testPathPattern=tests/feeEstimate.test.js

Or use the shorthand with just the filename stem:

    npx jest feeEstimate

Both forms work. Jest matches the pattern against the full file path, so the stem is enough as long as it is unambiguous.

### Run tests in watch mode during development

    npx jest --watch

Jest reruns only the files affected by your last change, which keeps the feedback loop tight.

### Run a single named test

    npx jest feeEstimate -t "includes new fields in the response"

---

## Test File Locations and Naming

All test files live in tests/ and follow the naming convention subject.qualifier.test.js (or simply subject.test.js for broader files). Examples:

    tests/
      feeEstimate.test.js
      feeEstimate.surgeStatus.test.js
      account.notFound.test.js
      account.balances.conversion.test.js
      dex.spread.test.js
      utils.formatBalance.test.js

One test file should cover one route, utility, or behaviour slice. Avoid large omnibus files.

---

## Mocking Horizon

All Horizon network calls go through the server object exported from src/config/stellar.js. Tests replace that object with Jest mocks so no real HTTP requests are made.

There are two patterns in use depending on whether the test needs to isolate module caching.

### Pattern A — jest.mock at module scope (preferred for most route tests)

Use this when the entire file needs the same mock configuration and you do not need to change the mock between describe blocks.

    const request = require("supertest");
    const { Keypair } = require("@stellar/stellar-sdk");
    const app = require("../src/index");
    const { server } = require("../src/config/stellar");

    jest.mock("../src/config/stellar", () => {
      const actual = jest.requireActual("../src/config/stellar");
      return {
        ...actual,
        server: {
          loadAccount: jest.fn(),
          transactions: jest.fn(),
          payments: jest.fn(),
          offers: jest.fn(),
          operations: jest.fn(),
        },
      };
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

jest.requireActual preserves helpers and constants that route handlers also import, so only the Horizon-calling methods are replaced.

### Pattern B — jest.resetModules + jest.doMock per test (use for cache-sensitive tests)

Some tests need to flush the module registry between runs to prevent cached Horizon responses from leaking across tests:

    let app;
    let server;

    beforeEach(() => {
      jest.resetModules();
      jest.doMock("../src/config/stellar", () => {
        const original = jest.requireActual("../src/config/stellar");
        return {
          ...original,
          server: {
            feeStats: jest.fn(),
            ledgers: jest.fn(),
          },
        };
      });

      ({ server } = require("../src/config/stellar"));
      app = require("../src/index");
    });

jest.doMock (not jest.mock) works inside beforeEach because it does not get hoisted to the top of the file by Babel.

### Mocking chained Horizon builder calls

Many Horizon methods return a builder that chains .forAccount(), .limit(), .order(), .cursor(), and .call(). Simulate the chain like this:

    function makeChain(resolvedValue) {
      const chain = {
        forAccount: () => chain,
        limit: () => chain,
        order: () => chain,
        cursor: () => chain,
        includeFailed: () => chain,
        call: jest.fn().mockResolvedValue(resolvedValue),
      };
      return chain;
    }

    server.transactions.mockReturnValue(makeChain({ records: [] }));

To simulate a 404 from Horizon:

    const HORIZON_404 = { response: { status: 404 } };

    function chain404() {
      const chain = {
        forAccount: () => chain404(),
        limit: () => chain404(),
        order: () => chain404(),
        cursor: () => chain404(),
        includeFailed: () => chain404(),
        call: jest.fn().mockRejectedValue(HORIZON_404),
      };
      return chain;
    }

    server.transactions.mockReturnValue(chain404());

---

## Coverage Threshold

The project does not currently enforce a hard threshold via Jest configuration, but the expectation for pull requests is:

    Statements: >= 80%
    Branches:   >= 75%
    Functions:  >= 80%
    Lines:      >= 80%

Check your contribution's impact with:

    npm test -- --coverage --coverageReporters=text

The summary table prints to the terminal after all tests finish. If your change introduces a new route or utility, add tests that cover the happy path and at least one error path before opening a PR.

---

## Complete Example — Testing a Route Handler

The test below covers GET /account/:id/balances. It verifies the happy-path response shape, a 404 when the account does not exist, and a 400 when the account ID is malformed.

    const request = require("supertest");
    const { Keypair } = require("@stellar/stellar-sdk");
    const app = require("../src/index");
    const { server } = require("../src/config/stellar");

    jest.mock("../src/config/stellar", () => {
      const actual = jest.requireActual("../src/config/stellar");
      return {
        ...actual,
        server: {
          loadAccount: jest.fn(),
        },
      };
    });

    const VALID_ID = Keypair.random().publicKey();
    const HORIZON_404 = { response: { status: 404 } };

    function makeHorizonAccount(overrides = {}) {
      return {
        account_id: VALID_ID,
        sequence: "12345678",
        balances: [
          {
            asset_type: "native",
            balance: "100.0000000",
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            balance: "50.0000000",
            limit: "1000.0000000",
            buying_liabilities: "0.0000000",
            selling_liabilities: "0.0000000",
          },
        ],
        subentry_count: 1,
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
        flags: { auth_required: false, auth_revocable: false, auth_immutable: false },
        signers: [{ key: VALID_ID, weight: 1, type: "ed25519_public_key" }],
        ...overrides,
      };
    }

    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe("GET /account/:id/balances", () => {
      it("returns XLM and asset balances for a funded account", async () => {
        server.loadAccount.mockResolvedValue(makeHorizonAccount());

        const res = await request(app).get(`/account/${VALID_ID}/balances`);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        const { xlm, assets } = res.body.data;

        expect(xlm).toHaveProperty("balance");
        expect(xlm).toHaveProperty("minimumBalance");
        expect(xlm).toHaveProperty("spendableBalance");
        expect(typeof xlm.balance).toBe("string");

        expect(Array.isArray(assets)).toBe(true);
        expect(assets.length).toBe(1);
        expect(assets[0]).toHaveProperty("code", "USDC");
        expect(assets[0]).toHaveProperty("balance");
      });

      it("returns 404 with AccountNotFound error when account does not exist", async () => {
        server.loadAccount.mockRejectedValue(HORIZON_404);

        const res = await request(app).get(`/account/${VALID_ID}/balances`);

        expect(res.statusCode).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.type).toBe("AccountNotFound");
        expect(res.body.error.message).toContain(VALID_ID);
      });

      it("returns 400 when the account ID is not a valid Stellar public key", async () => {
        const res = await request(app).get("/account/not-a-valid-key/balances");

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toHaveProperty("message");
      });
    });

---

## Response Envelope Assertions

Every endpoint wraps its response in the standard StellarKit envelope. Always check both the envelope and the payload:

    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("meta");

For error responses:

    expect(res.body.success).toBe(false);
    expect(res.body.error).toHaveProperty("type");
    expect(res.body.error).toHaveProperty("message");

---

## Useful Jest Flags

Flag           Purpose
--verbose      Print every it block as it runs
--runInBand    Run tests serially (useful when debugging race conditions)
--forceExit    Force Jest to exit after tests finish
--bail         Stop after the first failure

Example combining flags:

    npx jest account.notFound --verbose --runInBand
