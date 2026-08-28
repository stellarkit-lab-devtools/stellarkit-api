/**
 * Rejects HTTP methods the API does not support.
 *
 * Allowed: GET, POST, DELETE, PATCH.
 * Everything else (TRACE, CONNECT, OPTIONS, PUT, HEAD, …) is rejected
 * with 405 Method Not Allowed before any route handler runs.
 */

const ALLOWED_METHODS = new Set(["GET", "POST", "DELETE", "PATCH"]);

function restrictHttpMethods(req, res, next) {
  if (ALLOWED_METHODS.has(req.method)) {
    return next();
  }

  return res.status(405).json({
    success: false,
    error: {
      type: "MethodNotAllowed",
      message: "HTTP method not supported.",
    },
  });
}

module.exports = restrictHttpMethods;
module.exports.ALLOWED_METHODS = ALLOWED_METHODS;
