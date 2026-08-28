/**
 * Rejects requests that repeat the same query parameter key.
 * Runs before route handlers to prevent HTTP parameter pollution.
 */

function rejectDuplicateQueryParams(req, res, next) {
  const queryStart = req.originalUrl.indexOf("?");
  if (queryStart === -1) {
    return next();
  }

  const queryString = req.originalUrl.slice(queryStart + 1).split("#")[0];
  if (!queryString) {
    return next();
  }

  const seen = new Set();
  for (const part of queryString.split("&")) {
    if (!part) continue;
    const rawKey = part.split("=")[0];
    let key;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    } catch {
      key = rawKey;
    }
    if (seen.has(key)) {
      return res.status(400).json({
        success: false,
        error: {
          type: "DuplicateParameter",
          message: "Duplicate query parameter detected.",
        },
      });
    }
    seen.add(key);
  }

  next();
}

module.exports = rejectDuplicateQueryParams;
