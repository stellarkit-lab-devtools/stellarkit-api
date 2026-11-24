/**
 * Hardened HTTPS fetch helper for stellar.toml documents.
 *
 * Home domains on Stellar are attacker-controlled account data. A naive
 * `https://<domain>/.well-known/stellar.toml` fetch can therefore be used for
 * SSRF against loopback, RFC1918, link-local/CGNAT or cloud-metadata addresses.
 *
 * This helper:
 *   1. resolves DNS first and rejects every disallowed address range,
 *   2. connects to the vetted IP (with SNI/Host preserved) to defeat DNS
 *      rebinding,
 *   3. enforces HTTPS, a 5 second timeout and a 100 KB body cap,
 *   4. re-validates up to 2 redirect hops,
 *   5. throws only a generic SafeFetchError — never leaking the resolved IP or
 *      internal error text. Callers degrade to their existing "unavailable"
 *      result.
 */

const dns = require("dns");
const https = require("https");
const urlLib = require("url");

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 100 * 1024;
const MAX_REDIRECTS = 2;
const TOML_PATH = "/.well-known/stellar.toml";

/** Generic error type raised by safeFetch. Safe to surface to clients. */
class SafeFetchError extends Error {
  constructor(message = "stellar.toml is unavailable") {
    super(message);
    this.name = "SafeFetchError";
    this.code = "SAFE_FETCH_FAILED";
  }
}

function fail() {
  throw new SafeFetchError();
}

/** Parse an IPv4 address into four octets, or null. */
function parseIpv4(address) {
  if (typeof address !== "string") return null;
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return octets;
}

/**
 * True when `address` is in a range that must never be contacted.
 *
 * Covers IPv4 loopback/private/link-local/CGNAT, IPv6 loopback/ULA/
 * link-local, unspecified addresses, and IPv4-mapped IPv6 forms.
 */
function isBlockedAddress(address) {
  if (typeof address !== "string" || !address.trim()) return true;
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4-mapped IPv6 (::ffff:127.0.0.1). Reject any mapping of a blocked v4.
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  // Hex-form IPv4-mapped addresses, e.g. ::ffff:7f00:1 — treat as blocked.
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(value)) return true;

  const v4 = parseIpv4(value);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // private 10/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
    if (a === 192 && b === 168) return true; // private 192.168/16
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (value.includes(":")) {
    if (value === "::" || value === "::1") return true;
    const first = parseInt(value.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
    if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    // IPv6 loopback in expanded form, IPv4-compatible and site-local ranges.
    if (/^0*:0*1$/.test(value)) return true;
    if (/^0*:/.test(value) && /:(0*:)?0*1$/.test(value)) return true;
    if ((first & 0xffe0) === 0xfec0) return true; // site-local deprecated
    return false;
  }

  return true;
}

function normaliseDomain(homeDomain) {
  if (typeof homeDomain !== "string" || !homeDomain.trim()) return null;
  let value = homeDomain.trim();
  value = value.replace(/^https?:\/\//i, "").replace(/^[^/]*\//, (m) => m);
  // Strip any path, query, fragment, credentials and IPv6 brackets.
  try {
    const parsed = new urlLib.URL(`https://${value}`);
    if (parsed.username || parsed.password) return null;
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    if (!hostname || /[\s/\\]/.test(hostname)) return null;
    return hostname;
  } catch (_) {
    return null;
  }
}

function resolveDns(hostname, lookup) {
  return new Promise((resolve, reject) => {
    const done = (err, addresses) => {
      if (err) return reject(err);
      const list = Array.isArray(addresses) ? addresses : [addresses];
      const values = list
        .map((entry) => (entry && typeof entry === "object" ? entry.address : entry))
        .filter(Boolean);
      resolve(values);
    };

    try {
      const maybePromise = lookup(hostname, { all: true }, done);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then((addresses) => done(null, addresses), done);
      }
    } catch (err) {
      reject(err);
    }
  });
}

function requestOnce({ hostname, ip, path, port, timeoutMs, maxBodyBytes, request }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const req = request(
      {
        protocol: "https:",
        hostname: ip,
        host: ip,
        port: port || 443,
        path,
        method: "GET",
        servername: hostname, // TLS SNI stays the validated hostname
        headers: {
          Host: port && port !== 443 ? `${hostname}:${port}` : hostname,
          "User-Agent": "StellarKit-API/1.0",
          Accept: "text/plain,*/*",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        const chunks = [];
        let size = 0;

        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBodyBytes) {
            res.destroy();
            finish(reject, new SafeFetchError());
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => finish(resolve, { status, headers: res.headers || {}, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", () => finish(reject, new SafeFetchError()));
      },
    );

    timer = setTimeout(() => {
      req.destroy();
      finish(reject, new SafeFetchError());
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    req.on("error", () => finish(reject, new SafeFetchError()));
    req.end();
  });
}

/**
 * Fetch a stellar.toml over HTTPS with SSRF protections.
 *
 * @param {string} homeDomain - Issuer home domain (no scheme or path).
 * @param {object} [options] - Test seams: dnsLookup, request, timeoutMs.
 * @returns {Promise<string>} Raw TOML text.
 * @throws {SafeFetchError} Generic error for every failure mode.
 */
async function safeFetchToml(
  homeDomain,
  {
    dnsLookup = dns.lookup,
    request = https.request,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBodyBytes = MAX_BODY_BYTES,
    maxRedirects = MAX_REDIRECTS,
  } = {},
) {
  let hostname = normaliseDomain(homeDomain);
  if (!hostname) fail();
  let path = TOML_PATH;
  let port = 443;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    // Every hop (including the first) resolves and vets DNS afresh.
    let addresses;
    try {
      addresses = await resolveDns(hostname, dnsLookup);
    } catch (_) {
      fail();
    }
    if (!Array.isArray(addresses) || addresses.length === 0) fail();
    if (addresses.some((address) => isBlockedAddress(address))) fail();
    const ip = addresses[0];

    let response;
    try {
      response = await requestOnce({ hostname, ip, path, port, timeoutMs, maxBodyBytes, request });
    } catch (_) {
      fail();
    }

    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      if (hop === maxRedirects) fail();
      let next;
      try {
        next = new urlLib.URL(response.headers.location, `https://${hostname}`);
      } catch (_) {
        fail();
      }
      if (!next || next.protocol !== "https:") fail(); // HTTPS only, no downgrade
      hostname = normaliseDomain(next.hostname);
      if (!hostname || next.username || next.password) fail();
      path = `${next.pathname}${next.search}`;
      port = next.port ? Number(next.port) : 443;
      if (!Number.isInteger(port) || port <= 0 || port > 65535) fail();
      continue;
    }

    if (response.status < 200 || response.status >= 300) fail();
    return response.body;
  }

  fail();
}

module.exports = {
  safeFetchToml,
  safeFetch: safeFetchToml,
  SafeFetchError,
  isBlockedAddress,
  DEFAULT_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_REDIRECTS,
  TOML_PATH,
};
