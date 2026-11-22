const StellarKitError = require("../utils/StellarKitError");

function configuredLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

// Inspect the raw target, before duplicate removal, coercion or sanitisation.
module.exports = function urlLimits(req, res, next) {
  const url = req.originalUrl || req.url;
  if (url.length > configuredLimit("MAX_URL_LENGTH", 2048)) {
    return next(new StellarKitError("Request URL is too long.", 414, "UriTooLong"));
  }
  const queryStart = url.indexOf("?");
  const query = queryStart < 0 ? "" : url.slice(queryStart + 1);
  const count = query.split("&").filter(Boolean).length;
  if (count > configuredLimit("MAX_QUERY_PARAMS", 30)) {
    return next(new StellarKitError("Too many query parameters.", 400, "TooManyParameters"));
  }
  next();
};
