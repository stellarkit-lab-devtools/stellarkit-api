const express = require("express");
const request = require("supertest");
const { parseTrustProxy } = require("../src/config/trustProxy");

const SPOOFED_IP = "203.0.113.7";

describe("parseTrustProxy", () => {
  it("defaults to false when unset or blank", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("   ")).toBe(false);
  });

  it("accepts the literal false (case-insensitive)", () => {
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("FALSE")).toBe(false);
  });

  it("parses a hop count", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy("0")).toBe(false);
  });

  it("accepts loopback", () => {
    expect(parseTrustProxy("loopback")).toBe("loopback");
    expect(parseTrustProxy(" Loopback ")).toBe("loopback");
  });

  it("parses a comma-separated list of CIDRs and addresses", () => {
    expect(parseTrustProxy("10.0.0.0/8, 172.16.0.0/12,192.168.1.10")).toEqual([
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.1.10",
    ]);
  });

  it("parses IPv6 CIDRs and named ranges inside a list", () => {
    expect(parseTrustProxy("loopback,fd00::/8,2001:db8::1")).toEqual([
      "loopback",
      "fd00::/8",
      "2001:db8::1",
    ]);
  });

  it("rejects malformed CIDR entries", () => {
    expect(() => parseTrustProxy("10.0.0.0/33")).toThrow(/not a valid IP address or CIDR range/);
    expect(() => parseTrustProxy("10.0.0.0/8,not-an-ip")).toThrow(/not-an-ip/);
    expect(() => parseTrustProxy("300.1.1.1")).toThrow(/INVALID|not a valid/i);
    expect(() => parseTrustProxy(",,")).toThrow(/no addresses/);
  });

  it("rejects the literal true with an explanation", () => {
    expect(() => parseTrustProxy("true")).toThrow(/spoofable/);
    expect(() => parseTrustProxy("TRUE")).toThrow(/X-Forwarded-For/);
    try {
      parseTrustProxy("true");
    } catch (err) {
      expect(err.code).toBe("INVALID_TRUST_PROXY");
    }
  });
});

describe("req.ip with the parsed TRUST_PROXY setting", () => {
  function buildApp(rawTrustProxy) {
    const app = express();
    app.set("trust proxy", parseTrustProxy(rawTrustProxy));
    app.get("/ip", (req, res) => res.json({ ip: req.ip }));
    return app;
  }

  it("ignores X-Forwarded-For by default", async () => {
    const res = await request(buildApp(undefined))
      .get("/ip")
      .set("X-Forwarded-For", SPOOFED_IP);
    expect(res.body.ip).not.toBe(SPOOFED_IP);
  });

  it("uses the forwarded client IP with TRUST_PROXY=1", async () => {
    const res = await request(buildApp("1"))
      .get("/ip")
      .set("X-Forwarded-For", SPOOFED_IP);
    expect(res.body.ip).toBe(SPOOFED_IP);
  });

  it("only takes the hop nearest the trusted proxy with TRUST_PROXY=1", async () => {
    const res = await request(buildApp("1"))
      .get("/ip")
      .set("X-Forwarded-For", `198.51.100.1, ${SPOOFED_IP}`);
    expect(res.body.ip).toBe(SPOOFED_IP);
  });

  it("uses the forwarded IP when the proxy is inside a trusted CIDR list", async () => {
    const res = await request(buildApp("127.0.0.0/8,::1/128"))
      .get("/ip")
      .set("X-Forwarded-For", SPOOFED_IP);
    expect(res.body.ip).toBe(SPOOFED_IP);
  });

  it("ignores the header when the proxy is outside the CIDR list", async () => {
    const res = await request(buildApp("10.0.0.0/8"))
      .get("/ip")
      .set("X-Forwarded-For", SPOOFED_IP);
    expect(res.body.ip).not.toBe(SPOOFED_IP);
  });
});

describe("rate limiting and TRUST_PROXY (full app)", () => {
  const ORIGINAL_ENV = { ...process.env };

  function loadAppWith(env) {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, RATE_LIMIT_MAX: "2", ...env };
    if (env.TRUST_PROXY === undefined) delete process.env.TRUST_PROXY;
    return require("../src/index");
  }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it("refuses to start with TRUST_PROXY=true", () => {
    expect(() => loadAppWith({ TRUST_PROXY: "true" })).toThrow(/spoofable/);
  });

  it("does not let a spoofed X-Forwarded-For change the bucket by default", async () => {
    const app = loadAppWith({ TRUST_PROXY: undefined });

    // Every request claims a different client IP, but the header is ignored,
    // so they all share the socket's bucket and the third is rejected.
    await request(app).get("/__rate-limit-probe").set("X-Forwarded-For", "198.51.100.1");
    await request(app).get("/__rate-limit-probe").set("X-Forwarded-For", "198.51.100.2");
    const third = await request(app)
      .get("/__rate-limit-probe")
      .set("X-Forwarded-For", "198.51.100.3");

    expect(third.status).toBe(429);
  });

  it("buckets by the forwarded IP with TRUST_PROXY=1", async () => {
    const app = loadAppWith({ TRUST_PROXY: "1" });

    const a1 = await request(app).get("/__rate-limit-probe").set("X-Forwarded-For", "198.51.100.1");
    const a2 = await request(app).get("/__rate-limit-probe").set("X-Forwarded-For", "198.51.100.1");
    const b1 = await request(app).get("/__rate-limit-probe").set("X-Forwarded-For", "198.51.100.2");
    const a3 = await request(app).get("/__rate-limit-probe").set("X-Forwarded-For", "198.51.100.1");

    expect(a1.status).not.toBe(429);
    expect(a2.status).not.toBe(429);
    expect(b1.status).not.toBe(429);
    expect(a3.status).toBe(429);
  });
});
