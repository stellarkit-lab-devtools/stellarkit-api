const net = require("net");

/**
 * Named address ranges that Express understands natively in its
 * "trust proxy" setting. Only "loopback" is documented for operators, but the
 * other two are accepted inside a list for completeness.
 */
const NAMED_RANGES = new Set(["loopback", "linklocal", "uniquelocal"]);

function makeTrustProxyError(raw, reason) {
  const err = new Error(
    `[StellarKit] Invalid TRUST_PROXY value "${raw}": ${reason} ` +
      "Accepted values: false (default), a hop count such as 1, loopback, " +
      "or a comma-separated list of IP addresses / CIDR ranges " +
      "(e.g. 10.0.0.0/8,192.168.1.10).",
  );
  err.code = "INVALID_TRUST_PROXY";
  return err;
}

/**
 * Validates a single IP address or CIDR range (IPv4 or IPv6).
 *
 * @param {string} entry
 * @returns {boolean}
 */
function isValidAddressOrCidr(entry) {
  const slash = entry.indexOf("/");
  if (slash === -1) return net.isIP(entry) !== 0;

  const address = entry.slice(0, slash);
  const prefix = entry.slice(slash + 1);
  const family = net.isIP(address);
  if (family === 0 || !/^\d{1,3}$/.test(prefix)) return false;

  const bits = Number(prefix);
  return family === 4 ? bits <= 32 : bits <= 128;
}

/**
 * Parses the TRUST_PROXY environment variable into a value suitable for
 * `app.set("trust proxy", value)`.
 *
 *   - unset, "" or "false"      → false (X-Forwarded-For is ignored; req.ip is
 *                                 the socket address)
 *   - "0"                       → false
 *   - a positive integer ("1")  → that hop count
 *   - "loopback"                → "loopback"
 *   - "10.0.0.0/8,172.16.0.1"   → ["10.0.0.0/8", "172.16.0.1"]
 *
 * The literal "true" is rejected: trusting every hop means the left-most
 * X-Forwarded-For entry — which any client can set — becomes req.ip, so a
 * caller could pick a fresh rate-limit bucket on every request.
 *
 * @param {string|undefined} raw - Raw value of process.env.TRUST_PROXY
 * @returns {false|number|string|string[]}
 * @throws {Error} When the value is "true" or otherwise unparseable.
 */
function parseTrustProxy(raw) {
  if (raw === undefined || raw === null) return false;

  const value = String(raw).trim();
  if (value === "" || value.toLowerCase() === "false") return false;

  if (value.toLowerCase() === "true") {
    throw makeTrustProxyError(
      raw,
      "\"true\" trusts every hop, which makes X-Forwarded-For spoofable — any " +
        "client could send its own header and choose its own rate-limit bucket. " +
        "Set the number of proxies in front of the API (usually 1) or list their addresses instead.",
    );
  }

  if (/^\d+$/.test(value)) {
    const hops = Number.parseInt(value, 10);
    return hops === 0 ? false : hops;
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw makeTrustProxyError(raw, "no addresses were provided.");
  }

  const normalized = entries.map((entry) => {
    const lower = entry.toLowerCase();
    if (NAMED_RANGES.has(lower)) return lower;
    if (!isValidAddressOrCidr(entry)) {
      throw makeTrustProxyError(
        raw,
        `"${entry}" is not a valid IP address or CIDR range.`,
      );
    }
    return entry;
  });

  if (normalized.length === 1 && NAMED_RANGES.has(normalized[0])) {
    return normalized[0];
  }

  return normalized;
}

module.exports = { parseTrustProxy };
