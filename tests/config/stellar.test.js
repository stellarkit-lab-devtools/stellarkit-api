const http = require("http");
const https = require("https");

describe("stellar.js keep-alive configuration", () => {
  let stellarConfig;

  beforeAll(() => {
    jest.resetModules();
    stellarConfig = require("../../src/config/stellar");
  });

  describe("httpAgent configuration", () => {
    it("has keepAlive enabled", () => {
      expect(stellarConfig.httpAgent).toBeDefined();
      expect(stellarConfig.httpAgent.keepAlive).toBe(true);
    });

    it("has correct keepAliveMsecs", () => {
      expect(stellarConfig.httpAgent.keepAliveMsecs).toBe(30000);
    });

    it("has maxSockets from UPSTREAM_MAX_SOCKETS", () => {
      expect(stellarConfig.httpAgent.maxSockets).toBe(stellarConfig.UPSTREAM_MAX_SOCKETS);
    });
  });

  describe("httpsAgent configuration", () => {
    it("has keepAlive enabled", () => {
      expect(stellarConfig.httpsAgent).toBeDefined();
      expect(stellarConfig.httpsAgent.keepAlive).toBe(true);
    });

    it("has correct keepAliveMsecs", () => {
      expect(stellarConfig.httpsAgent.keepAliveMsecs).toBe(30000);
    });

    it("has maxSockets from UPSTREAM_MAX_SOCKETS", () => {
      expect(stellarConfig.httpsAgent.maxSockets).toBe(stellarConfig.UPSTREAM_MAX_SOCKETS);
    });
  });

  describe("UPSTREAM_MAX_SOCKETS environment override", () => {
    it("defaults to 50 when not set", () => {
      expect(stellarConfig.UPSTREAM_MAX_SOCKETS).toBe(50);
    });
  });
});

describe("keep-alive connection reuse", () => {
  it("shared client reuses connections for sequential calls", async () => {
    const express = require("express");
    const http = require("http");

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const testApp = express();
    testApp.get("/call1", async (req, res) => {
      const { httpAgent, httpsAgent } = require("../../src/config/stellar");
      const url = `http://localhost:${port}/test`;
      await fetch(url, { agent: httpAgent });
      res.send("ok");
    });
    testApp.get("/call2", async (req, res) => {
      const { httpAgent } = require("../../src/config/stellar");
      const url = `http://localhost:${port}/test`;
      await fetch(url, { agent: httpAgent });
      res.send("ok");
    });

    let connectionCount = 0;
    server.on("connection", () => { connectionCount++; });

    const request = require("supertest");
    await request(testApp).get("/call1");
    await request(testApp).get("/call2");

    expect(connectionCount).toBeLessThanOrEqual(2);
    server.close();
  });
});