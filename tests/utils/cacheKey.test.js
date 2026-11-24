"use strict";

/**
 * tests/utils/cacheKey.test.js
 *
 * Unit and route-level tests for the shared cacheKey() helper.
 *
 * Covers:
 *   - parameter order does not change the key
 *   - unknown parameters are dropped from the key
 *   - explicit defaults equal implicit ones (limit=20 vs no limit)
 *   - values are never case-folded (USDC ≠ usdc)
 *   - ?fresh=true bypasses the read but repopulates the normal key
 */

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");
const { cacheKey, isFresh } = require("../../src/utils/cacheKey");

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const OPTIONS = {
  namespace: "test",
  allowedParams: ["limit", "order", "cursor", "assetCode"],
  defaults: { limit: 20, order: "desc" },
};

function req(query, extra = {}) {
  return { query, baseUrl: "", path: "/", ...extra };
}

describe("cacheKey() — unit", () => {
  it("produces the same key regardless of parameter order", () => {
    const a = cacheKey(req({ limit: "5", order: "asc", cursor: "123" }), OPTIONS);
    const b = cacheKey(req({ cursor: "123", order: "asc", limit: "5" }), OPTIONS);
    expect(a).toBe(b);
    expect(a).toBe("test?cursor=123&limit=5&order=asc");
  });

  it("drops parameters not in the declared set", () => {
    const base = cacheKey(req({}), OPTIONS);
    expect(cacheKey(req({ x: "1" }), OPTIONS)).toBe(base);
    expect(cacheKey(req({ x: "2", y: "abc" }), OPTIONS)).toBe(base);
    expect(cacheKey(req({ fresh: "true" }), OPTIONS)).toBe(base);
  });

  it("treats explicit default values the same as implicit ones", () => {
    const implicit = cacheKey(req({}), OPTIONS);
    const explicit = cacheKey(req({ limit: "20", order: "desc" }), OPTIONS);
    const coerced = cacheKey(req({ limit: 20 }), OPTIONS);
    expect(explicit).toBe(implicit);
    expect(coerced).toBe(implicit);
    expect(implicit).toBe("test?limit=20&order=desc");
  });

  it("distinguishes non-default values", () => {
    expect(cacheKey(req({ limit: "50" }), OPTIONS)).not.toBe(cacheKey(req({}), OPTIONS));
  });

  it("never case-folds values (USDC vs usdc)", () => {
    const upper = cacheKey(req({ assetCode: "USDC" }), OPTIONS);
    const lower = cacheKey(req({ assetCode: "usdc" }), OPTIONS);
    expect(upper).not.toBe(lower);
    expect(upper).toContain("assetCode=USDC");
    expect(lower).toContain("assetCode=usdc");
  });

  it("returns the bare namespace when no parameters remain", () => {
    expect(cacheKey(req({ x: "1" }), { namespace: "network-status" })).toBe("network-status");
  });

  it("falls back to the request path when no namespace is given", () => {
    const key = cacheKey(req({ limit: "5" }, { baseUrl: "/account", path: "/GABC/payments/" }), {
      allowedParams: ["limit"],
    });
    expect(key).toBe("/account/GABC/payments?limit=5");
  });

  it("isFresh() recognises boolean and string true only", () => {
    expect(isFresh(req({ fresh: true }))).toBe(true);
    expect(isFresh(req({ fresh: "true" }))).toBe(true);
    expect(isFresh(req({ fresh: "false" }))).toBe(false);
    expect(isFresh(req({}))).toBe(false);
  });
});

// ── Route-level behaviour ─────────────────────────────────────────────────────

function mockPayments(records = []) {
  const call = jest.fn().mockResolvedValue({ records });
  const chain = {};
  chain.limit = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.cursor = jest.fn(() => chain);
  chain.call = call;
  jest.spyOn(server, "payments").mockReturnValue({ forAccount: jest.fn(() => chain) });
  return call;
}

function fakeAccount(balance) {
  return {
    id: ACCOUNT,
    sequence: "1",
    subentry_count: 0,
    balances: [{ asset_type: "native", balance }],
    signers: [],
    thresholds: {},
    flags: {},
  };
}

describe("cacheKey() — routes", () => {
  beforeEach(() => cacheService.flush());
  afterEach(() => jest.restoreAllMocks());

  it("serves reordered query params from one cache entry", async () => {
    const call = mockPayments();

    const first = await request(app).get(`/account/${ACCOUNT}/payments?limit=5&order=asc`);
    const second = await request(app).get(`/account/${ACCOUNT}/payments?order=asc&limit=5`);

    expect(first.headers["x-cache"]).toBe("MISS");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("ignores unknown query params so ?x=1, ?x=2 cannot defeat the cache", async () => {
    const call = mockPayments();

    await request(app).get(`/account/${ACCOUNT}/payments?x=1`);
    const res = await request(app).get(`/account/${ACCOUNT}/payments?x=2`);

    expect(res.headers["x-cache"]).toBe("HIT");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("treats an explicit limit=20 the same as the implicit default", async () => {
    const call = mockPayments();

    await request(app).get(`/account/${ACCOUNT}/payments`);
    const res = await request(app).get(`/account/${ACCOUNT}/payments?limit=20`);

    expect(res.headers["x-cache"]).toBe("HIT");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("keeps USDC and usdc filters in separate entries", async () => {
    const call = mockPayments();

    await request(app).get(`/account/${ACCOUNT}/payments?assetCode=USDC`);
    const res = await request(app).get(`/account/${ACCOUNT}/payments?assetCode=usdc`);

    expect(res.headers["x-cache"]).toBe("MISS");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("?fresh=true bypasses the read but repopulates the normal key", async () => {
    const loadAccount = jest
      .spyOn(server, "loadAccount")
      .mockResolvedValueOnce(fakeAccount("100.0000000"))
      .mockResolvedValueOnce(fakeAccount("250.0000000"));

    const first = await request(app).get(`/account/${ACCOUNT}`);
    expect(first.headers["x-cache"]).toBe("MISS");

    const fresh = await request(app).get(`/account/${ACCOUNT}?fresh=true`);
    expect(fresh.headers["x-cache"]).toBe("MISS");
    expect(loadAccount).toHaveBeenCalledTimes(2);

    // The fresh response replaced the normal entry, so a plain request now
    // hits the cache and sees the refreshed data.
    const after = await request(app).get(`/account/${ACCOUNT}?x=1`);
    expect(after.headers["x-cache"]).toBe("HIT");
    expect(after.body.data).toEqual(fresh.body.data);
    expect(after.body.data).not.toEqual(first.body.data);
    expect(loadAccount).toHaveBeenCalledTimes(2);
  });
});
