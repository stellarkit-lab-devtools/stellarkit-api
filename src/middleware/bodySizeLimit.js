const express = require("express");

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_KB = 10;

/**
 * Resolve the maximum allowed request body size in kilobytes.
 *
 * Priority:
 *   1. MAX_BODY_SIZE_KB  — numeric KB value (e.g. "10")
 *   2. MAX_BODY_SIZE     — legacy size string  (e.g. "10kb", "1mb")
 *   3. Hard default      — 10 KB
 *
 * @returns {{ kb: number, expressLimit: string }}
 */
function resolveLimit() {
  // MAX_BODY_SIZE_KB takes priority — plain kilobyte number
  const kbEnv = process.env.MAX_BODY_SIZE_KB;
  if (kbEnv !== undefined && kbEnv !== "") {
    const parsed = parseFloat(kbEnv);
    if (!isNaN(parsed) && parsed > 0) {
      return { kb: parsed, expressLimit: `${parsed}kb` };
    }
  }

  // Legacy MAX_BODY_SIZE string — parse unit to derive KB equivalent
  const legacyEnv = process.env.MAX_BODY_SIZE;
  if (legacyEnv !== undefined && legacyEnv !== "") {
    const normalized = String(legacyEnv).trim().toLowerCase();
    const mbMatch = normalized.match(/^([0-9]*\.?[0-9]+)mb$/);
    if (mbMatch) {
      const kb = parseFloat(mbMatch[1]) * 1024;
      return { kb, expressLimit: normalized };
    }
    const kbMatch = normalized.match(/^([0-9]*\.?[0-9]+)kb$/);
    if (kbMatch) {
      return { kb: parseFloat(kbMatch[1]), expressLimit: normalized };
    }
    const bMatch = normalized.match(/^([0-9]+)b?$/);
    if (bMatch) {
      const kb = parseInt(bMatch[1], 10) / 1024;
      return { kb, expressLimit: `${bMatch[1]}b` };
    }
  }

  return { kb: DEFAULT_MAX_KB, expressLimit: `${DEFAULT_MAX_KB}kb` };
}

const requestBodySizeLimit = normalizeMaxBodySize(MAX_BODY_SIZE);

// Capture raw body for webhook signature verification
const bodySizeLimit = express.json({
  limit: requestBodySizeLimit,
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString(encoding || 'utf8');
  },
});

module.exports = bodySizeLimit;

/**
 * The resolved Express-compatible limit string (e.g. "10kb").
 * Exported so tests can assert the correct value is in use.
 */
module.exports.MAX_BODY_SIZE = EXPRESS_LIMIT;

/**
 * The resolved limit in kilobytes as a number.
 * Exported for use in error messages and tests.
 */
module.exports.MAX_BODY_SIZE_KB = MAX_KB;
