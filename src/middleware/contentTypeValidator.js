const BODY_METHODS = new Set(["POST", "PATCH"]);

function hasRequestBody(req) {
  const contentLength = req.headers["content-length"];

  if (contentLength && Number(contentLength) > 0) {
    return true;
  }

  return Boolean(req.headers["transfer-encoding"]);
}

function contentTypeValidator(req, res, next) {
  if (!BODY_METHODS.has(req.method) || !hasRequestBody(req)) {
    return next();
  }

  if (req.is("application/json")) {
    return next();
  }

  return res.status(400).json({
    success: false,
    error: {
      type: "ValidationError",
      message: "Content-Type must be application/json for requests with a body.",
    },
  });
}

module.exports = contentTypeValidator;
