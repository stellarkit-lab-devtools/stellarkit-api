"use strict";

const { formatAmount } = require("./formatAmount");
const { toISOTimestamp } = require("./response");

/**
 * Escapes a value for use in a CSV cell following RFC 4180:
 *  - quotes are doubled and the cell is wrapped in double quotes when it
 *    contains a comma, quote or newline;
 *  - cells starting with =, +, - or @ are prefixed with a single quote to
 *    prevent spreadsheet formula injection.
 */
function escapeCsvCell(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Builds a CSV document (header row + data rows, CRLF line endings). */
function toCsv(headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** Flattens nested objects into dot-free camelCase column names. */
function flattenRow(row, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(row || {})) {
    const name = prefix ? `${prefix}${key[0].toUpperCase()}${key.slice(1)}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenRow(value, name, out);
    } else {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Validates the ?format query param. Returns "json" when absent.
 * Throws a validation error (HTTP 400 via the error handler) otherwise.
 */
function parseExportFormat(value) {
  if (value === undefined) return "json";
  const format = String(value).toLowerCase();
  if (format !== "json" && format !== "csv") {
    const err = new Error(`Unsupported format "${value}". Use "json" or "csv".`);
    err.isValidation = true;
    err.field = "format";
    err.receivedValue = value;
    err.expectedFormat = "json or csv";
    throw err;
  }
  return format;
}

module.exports = {
  escapeCsvCell,
  toCsv,
  flattenRow,
  parseExportFormat,
  csvAmount: formatAmount,
  csvTimestamp: toISOTimestamp,
};
