"use strict";

/**
 * Response-timing configuration.
 *
 * `MIN_RESPONSE_TIME_MS` sets a floor (in milliseconds) on how quickly
 * account-format validation rejections are returned. A malformed account ID
 * fails synchronously inside `validateAccountId` (before any Horizon call),
 * so without a floor the 400 it produces arrives noticeably faster than the
 * 404 for a well-formed but non-existent account, which requires a Horizon
 * round trip. That timing gap can be used to enumerate valid account formats,
 * so the targeted validation 400s are padded up to this floor.
 */

const DEFAULT_MIN_RESPONSE_TIME_MS = 200;

/**
 * Parse a raw `MIN_RESPONSE_TIME_MS` value into a usable millisecond delay.
 *
 * Missing, empty/whitespace-only, non-numeric, negative, or non-finite values
 * fall back to `fallback` (default 200). `"0"` (or `0`) is a valid value that
 * disables padding entirely.
 *
 * @param {*} raw - Raw value, typically read from `process.env`.
 * @param {number} [fallback=DEFAULT_MIN_RESPONSE_TIME_MS] - Value used when raw is invalid.
 * @returns {number} A non-negative integer number of milliseconds.
 */
function parseMinResponseTimeMs(raw, fallback = DEFAULT_MIN_RESPONSE_TIME_MS) {
  if (raw === undefined || raw === null) {
    return fallback;
  }

  const normalized = typeof raw === "number" ? raw : String(raw).trim();
  if (normalized === "") {
    return fallback;
  }

  const parsed = typeof normalized === "number" ? normalized : Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

const MIN_RESPONSE_TIME_MS = parseMinResponseTimeMs(process.env.MIN_RESPONSE_TIME_MS);

module.exports = {
  DEFAULT_MIN_RESPONSE_TIME_MS,
  parseMinResponseTimeMs,
  MIN_RESPONSE_TIME_MS,
};
