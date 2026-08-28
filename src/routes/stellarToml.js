const express = require("express");
const { success } = require("../utils/response");
const { fetchNormalisedToml } = require("../utils/tomlResolver");
const registerParamValidation = require("../middleware/validateRouteParams");

const router = express.Router();
registerParamValidation(router);

function validateDomain(domain) {
  if (!domain || typeof domain !== "string" || domain.trim() === "") {
    const err = new Error("Domain parameter is required.");
    err.statusCode = 400;
    err.isValidation = true;
    throw err;
  }

  const normalized = domain.trim();
  const domainPattern = /^(?!-)(?!.*-$)(?!.*\.\.)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
  if (!domainPattern.test(normalized) || normalized.length > 253) {
    const err = new Error(
      `Invalid domain parameter: "${domain}". Provide a valid hostname without protocol or path.`
    );
    err.statusCode = 400;
    err.isValidation = true;
    throw err;
  }

  return normalized;
}

/**
 * GET /stellar-toml
 * Returns an error when no domain parameter is provided.
 * This endpoint requires a domain parameter in the path (use GET /stellar-toml/:domain instead).
 *
 * @example
 * GET /stellar-toml
 */
router.get("/", (req, res, next) => {
  const err = new Error("Domain parameter is required.");
  err.statusCode = 400;
  err.isValidation = true;
  next(err);
});

/**
 * GET /stellar-toml/:domain
 * Fetches and parses the stellar.toml file from the specified domain.
 * Returns normalised camelCase TOML data. Optional fields are always present
 * as null rather than omitted.
 *
 * Query params:
 *   - fresh (boolean, default: false) — bypasses the cache when set to "true"
 *
 * Response headers:
 *   - X-Cache: HIT  — served from cache
 *   - X-Cache: MISS — fetched live and cached
 *
 * Cache TTL is configurable via the CACHE_TTL_TOML_MS environment variable
 * (default: 300 000 ms / 5 minutes).
 *
 * @param {string} domain - Hostname without protocol or path (e.g., "stellar.org")
 *
 * @example
 * GET /stellar-toml/stellar.org
 * GET /stellar-toml/testanchor.stellar.org
 * GET /stellar-toml/stellar.org?fresh=true
 */
router.get("/:domain", async (req, res, next) => {
  try {
    const domain = validateDomain(req.params.domain);
    const fresh = req.query.fresh === "true";

    const { toml, cacheHit } = await fetchNormalisedToml(domain, fresh);

    if (!toml) {
      const err = new Error(`stellar.toml not found for domain ${domain}`);
      err.statusCode = 404;
      throw err;
    }

    res.set("X-Cache", cacheHit ? "HIT" : "MISS");
    return success(res, toml);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
