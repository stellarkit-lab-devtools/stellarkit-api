const express = require("express");
const { success } = require("../utils/response");
const { fetchStellarToml } = require("../utils/tomlResolver");

const router = express.Router();

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

router.get("/", (req, res, next) => {
  const err = new Error("Domain parameter is required.");
  err.statusCode = 400;
  err.isValidation = true;
  next(err);
});

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
