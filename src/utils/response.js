/**
 * Wraps data in a consistent success response envelope.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {any} data - The data payload to send.
 * @param {Object} [meta={}] - Optional metadata to merge into the response.
 * @returns {import('express').Response} The Express response.
 */
function success(res, data, meta = {}) {
  return res.json({
    success: true,
    ...meta,
    data,
  });
}

/**
 * Formats a Stellar timestamp into a readable ISO string.
 *
 * @param {string|number|Date|null|undefined} ts - The timestamp to format.
 * @returns {string|null} ISO string or null when timestamp is falsy.
 */
function formatTimestamp(ts) {
  if (!ts) return null;
  return new Date(ts).toISOString();
}

/**
 * Strips unnecessary Horizon _links fields from a record.
 *
 * @param {Object|null|undefined} obj - The object to clean.
 * @returns {Object|null|undefined} The object without _links or the original value if invalid.
 */
function stripLinks(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const { _links, ...rest } = obj;
  return rest;
}

module.exports = { success, formatTimestamp, stripLinks };
