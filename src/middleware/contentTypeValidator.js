/**
 * Content-Type validation middleware.
 *
 * All state-changing requests (POST and PATCH) must declare
 * `Content-Type: application/json`. Requests that omit the header or supply
 * a different media type are rejected with HTTP 415 Unsupported Media Type
 * before the body is parsed or any route handler runs.
 *
 * GET, DELETE, and other non-mutating methods are unaffected.
 */

const BODY_METHODS = new Set(["POST", "PATCH"]);

function contentTypeValidator(req, res, next) {
  if (!BODY_METHODS.has(req.method)) {
    return next();
  }

  if (req.is("application/json")) {
    return next();
  }

  return res.status(415).json({
    success: false,
    error: {
      type: "InvalidContentType",
      message: "Content-Type must be application/json.",
    },
  });
}

module.exports = contentTypeValidator;
