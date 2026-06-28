const express = require("express");
const { success } = require("../utils/response");
const { fetchStellarToml } = require("../utils/tomlResolver");
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
 * Returns structured TOML data containing asset issuer information, currency metadata,
 * validator details, and other Stellar anchor service configurations.
 *
 * @param {string} domain - Hostname without protocol or path (e.g., "stellar.org" or "example.com")
 *
 * @example
 * GET /stellar-toml/stellar.org
 * GET /stellar-toml/testanchor.stellar.org
 */
router.get("/:domain", async (req, res, next) => {
  try {
    const domain = validateDomain(req.params.domain);
    const toml = await fetchStellarToml(domain);

    if (!toml) {
      const err = new Error(`stellar.toml not found for domain ${domain}`);
      err.statusCode = 404;
      throw err;
    }

    return success(res, toml);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
