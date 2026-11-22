/**
 * Shared cache-key builder.
 *
 * Without normalisation every distinct query string produces a distinct cache
 * key, so appending throwaway parameters (?x=1, ?x=2, ...) turns every request
 * into a cache miss and forwards it to Horizon. `cacheKey()` builds a
 * canonical key so that equivalent requests share one cache entry:
 *
 *   1. Only parameters in the route's declared `allowedParams` set are kept;
 *      anything else (including `fresh`, which only controls cache reads) is
 *      dropped.
 *   2. `defaults` are applied before keying, so an explicit `?limit=20` and an
 *      implicit (absent) limit that defaults to 20 produce the same key.
 *   3. Parameters are sorted by name, so `?a=1&b=2` equals `?b=2&a=1`.
 *   4. Values are never case-folded — asset codes are case-sensitive on
 *      Stellar, so `USDC` and `usdc` must stay distinct.
 *
 * Key format:
 *   "<namespace>"                       when no parameters remain
 *   "<namespace>?<k1>=<v1>&<k2>=<v2>"   otherwise (keys sorted, URI-encoded)
 *
 * The namespace defaults to the request path (`req.baseUrl + req.path`, with
 * any trailing slash removed) and can be overridden with `options.namespace`.
 *
 * @example
 * const key = cacheKey(req, {
 *   namespace: `account-payments:${id}`,
 *   allowedParams: ["limit", "order", "cursor"],
 *   defaults: { limit: 10, order: "desc" },
 * });
 */

/**
 * Normalise a single query value into its string form for keying.
 * Arrays (repeated params) are joined with "," in their original order.
 *
 * @param {*} value
 * @returns {string|undefined} undefined when the value should be treated as absent.
 */
function stringifyValue(value) {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const parts = value.map(stringifyValue).filter((v) => v !== undefined);
    return parts.length ? parts.join(",") : undefined;
  }
  const str = String(value);
  return str === "" ? undefined : str;
}

/**
 * Derive the default namespace from an Express request.
 *
 * @param {object} req
 * @returns {string}
 */
function defaultNamespace(req) {
  const base = (req && req.baseUrl) || "";
  const path = (req && req.path) || "";
  const full = `${base}${path}`.replace(/\/+$/, "");
  return full || "/";
}

/**
 * Build a canonical cache key for a request.
 *
 * @param {object} req - Express request (only `query`, `baseUrl` and `path` are read).
 * @param {object} [options]
 * @param {string[]} [options.allowedParams=[]] - Query params that affect the response.
 * @param {object}   [options.defaults={}]      - Default values applied before keying.
 * @param {string}   [options.namespace]        - Key prefix; defaults to the request path.
 * @returns {string}
 */
function cacheKey(req, { allowedParams = [], defaults = {}, namespace } = {}) {
  const query = (req && req.query) || {};
  const prefix = namespace || defaultNamespace(req);

  const entries = [];
  for (const name of [...new Set(allowedParams)].sort()) {
    let value = stringifyValue(query[name]);
    if (value === undefined && Object.prototype.hasOwnProperty.call(defaults, name)) {
      value = stringifyValue(defaults[name]);
    }
    if (value === undefined) continue;
    entries.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  }

  return entries.length ? `${prefix}?${entries.join("&")}` : prefix;
}

/**
 * Returns true when the request asks to bypass the cache read (`?fresh=true`).
 * A fresh request still repopulates the normal key produced by `cacheKey()`.
 *
 * @param {object} req
 * @returns {boolean}
 */
function isFresh(req) {
  const fresh = req && req.query ? req.query.fresh : undefined;
  return fresh === true || fresh === "true";
}

module.exports = { cacheKey, isFresh };
