"use strict";

const EventEmitter = require("events");
const {
  safeFetchToml,
  isBlockedAddress,
  SafeFetchError,
} = require("../../src/utils/safeFetch");

function lookupFor(addresses) {
  return (_hostname, _opts, callback) => callback(null, addresses.map((address) => ({ address })));
}

function okRequest(body = "VERSION='1.0.0'", status = 200, headers = {}) {
  return jest.fn((_opts, callback) => {
    const res = new EventEmitter();
    res.statusCode = status;
    res.headers = headers;
    process.nextTick(() => {
      callback(res);
      res.emit("data", Buffer.from(body));
      res.emit("end");
    });
    return { on: jest.fn(), destroy: jest.fn(), end: jest.fn() };
  });
}

describe("safeFetch (SSRF protection)", () => {
  it("allows a public IP and connects to the vetted IP with SNI preserved", async () => {
    const request = okRequest();
    const body = await safeFetchToml("example.com", {
      dnsLookup: lookupFor(["93.184.216.34"]),
      request,
    });
    expect(body).toBe("VERSION='1.0.0'");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      hostname: "93.184.216.34",
      servername: "example.com",
      port: 443,
      path: "/.well-known/stellar.toml",
    });
    expect(request.mock.calls[0][0].headers.Host).toBe("example.com");
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["private 10/8", "10.1.2.3"],
    ["private 172.16/12", "172.16.0.1"],
    ["private 192.168/16", "192.168.1.1"],
    ["link-local / cloud metadata", "169.254.169.254"],
    ["CGNAT 100.64/10", "100.64.0.1"],
    ["IPv6 loopback", "::1"],
    ["IPv6 ULA", "fd00::1"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv4-mapped IPv6", "::ffff:127.0.0.1"],
  ])("blocks %s", async (_label, address) => {
    expect(isBlockedAddress(address)).toBe(true);
    const request = okRequest();
    await expect(
      safeFetchToml("attacker.example", {
        dnsLookup: lookupFor([address]),
        request,
      }),
    ).rejects.toBeInstanceOf(SafeFetchError);
    expect(request).not.toHaveBeenCalled();
  });

  it("allows a benign public IPv6 address", () => {
    expect(isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });

  it("rejects a redirect to a private IP and re-validates each hop", async () => {
    const request = jest.fn((opts, callback) => {
      const res = new EventEmitter();
      res.statusCode = 302;
      res.headers = { location: "https://internal.example/.well-known/stellar.toml" };
      process.nextTick(() => {
        callback(res);
        res.emit("end");
      });
      return { on: jest.fn(), destroy: jest.fn(), end: jest.fn() };
    });
    await expect(
      safeFetchToml("public.example", {
        dnsLookup: (_hostname, _opts, cb) =>
          cb(null, [
            {
              address:
                _hostname === "public.example" ? "93.184.216.34" : "169.254.169.254",
            },
          ]),
        request,
      }),
    ).rejects.toBeInstanceOf(SafeFetchError);
    expect(request).toHaveBeenCalledTimes(1); // second hop never connects
  });

  it("rejects http:// redirects (HTTPS only)", async () => {
    const request = jest.fn((_opts, callback) => {
      const res = new EventEmitter();
      res.statusCode = 301;
      res.headers = { location: "http://public.example/.well-known/stellar.toml" };
      process.nextTick(() => {
        callback(res);
        res.emit("end");
      });
      return { on: jest.fn(), destroy: jest.fn(), end: jest.fn() };
    });
    await expect(
      safeFetchToml("public.example", {
        dnsLookup: lookupFor(["93.184.216.34"]),
        request,
      }),
    ).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("caps the response body at 100 KB", async () => {
    const request = jest.fn((_opts, callback) => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {};
      res.destroy = jest.fn();
      process.nextTick(() => {
        callback(res);
        res.emit("data", Buffer.alloc(100 * 1024 + 1, "a"));
      });
      return { on: jest.fn(), destroy: jest.fn(), end: jest.fn() };
    });
    await expect(
      safeFetchToml("example.com", {
        dnsLookup: lookupFor(["93.184.216.34"]),
        request,
        maxBodyBytes: 100 * 1024,
      }),
    ).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("times out after the configured deadline without leaking internals", async () => {
    const request = jest.fn(() => ({
      on: jest.fn(),
      destroy: jest.fn(),
      end: jest.fn(),
    }));
    await expect(
      safeFetchToml("example.com", {
        dnsLookup: lookupFor(["93.184.216.34"]),
        request,
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ name: "SafeFetchError" });
    try {
      await safeFetchToml("example.com", {
        dnsLookup: lookupFor(["93.184.216.34"]),
        request,
        timeoutMs: 10,
      });
    } catch (err) {
      expect(err.message).toBe("stellar.toml is unavailable");
      expect(err.message).not.toMatch(/93\.184\.216\.34|example\.com/);
    }
  });
});
