/**
 * Sanitize middleware for all incoming route parameters and query strings.
 * - Trims whitespace from all req.params and req.query string values
 * - Strips null bytes (\0) from all string inputs
 * - Returns 400 if any single param or query value exceeds 500 characters
 */

const MAX_PARAM_LENGTH = 500;

function sanitizeString(value) {
  return value.trim().replace(/\0/g, "");
}

function validateMaxLengthOnString(value, res) {
  if (value.length > MAX_PARAM_LENGTH) {
    res.status(400).json({
      success: false,
      error: {
        type: "ValidationError",
        message: `Input exceeds maximum allowed length of ${MAX_PARAM_LENGTH} characters.`,
      },
    });
    return false;
  }
  return true;
}

function sanitizeAny(value, res) {
  if (typeof value === "string") {
    if (!validateMaxLengthOnString(value, res)) return { aborted: true };
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const sanitized = sanitizeAny(item, res);
      if (sanitized && sanitized.aborted) return { aborted: true };
      out.push(sanitized);
    }
    return out;
  }

  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const sanitized = sanitizeAny(v, res);
      if (sanitized && sanitized.aborted) return { aborted: true };
      out[k] = sanitized;
    }
    return out;
  }

  return value;
}

function sanitize(req, res, next) {
  const sources = [
    req.params || null,
    req.query || null,
    req.body || null,
  ];

  // Validate max-length for any string field first (without mutating)
  function walkValidate(value) {
    if (typeof value === "string") {
      return value.length <= MAX_PARAM_LENGTH;
    }
    if (Array.isArray(value)) {
      return value.every(walkValidate);
    }
    if (value && typeof value === "object") {
      return Object.values(value).every(walkValidate);
    }
    return true;
  }

  const allOk = sources.every((src) => (src ? walkValidate(src) : true));
  if (!allOk) {
    return res.status(400).json({
      success: false,
      error: {
        type: "ValidationError",
        message: `Input exceeds maximum allowed length of ${MAX_PARAM_LENGTH} characters.`,
      },
    });
  }

  // Sanitize req.params
  for (const key of Object.keys(req.params || {})) {
    req.params[key] = sanitizeString(req.params[key]);
  }

  // Sanitize req.query
  for (const key of Object.keys(req.query || {})) {
    const val = req.query[key];
    if (Array.isArray(val)) {
      req.query[key] = val.map((v) => (typeof v === "string" ? sanitizeString(v) : v));
    } else {
      req.query[key] = typeof val === "string" ? sanitizeString(val) : val;
    }
  }

  // Sanitize req.body (strings only; recursively handles objects/arrays)
  if (req.body && typeof req.body === "object") {
    const sanitized = sanitizeAny(req.body, res);
    if (sanitized && sanitized.aborted) return;
    req.body = sanitized;
  }

  next();
}

module.exports = sanitize;
