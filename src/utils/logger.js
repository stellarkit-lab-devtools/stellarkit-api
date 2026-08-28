/**
 * Structured logger configuration using Pino.
 *
 * Supports LOG_LEVEL env var to control verbosity.
 * Outputs JSON in production, pretty-printed in development.
 *
 * Sensitive fields are automatically redacted before any log entry is written:
 *   - HTTP headers: `authorization`, `x-api-key`
 *   - Body / object fields: any property named `secret` or `key`
 */

const pino = require("pino");

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Pino redact paths.
 *
 * fast-redact (Pino's underlying library) uses a subset of JSON path syntax.
 * Hyphenated header names like x-api-key must be accessed with bracket
 * notation using double-quoted strings: headers["x-api-key"].
 *
 * Wildcard `*` matches any single object key at that level, and `[*]` matches
 * any array element, so `*.secret` catches { body: { secret: "…" } }, etc.
 */
const REDACT_PATHS = [
  // Authorization header at various nesting depths
  "req.headers.authorization",
  "headers.authorization",
  // x-api-key header — bracket notation required for hyphenated keys
  'req.headers["x-api-key"]',
  'headers["x-api-key"]',
  // Body fields named "secret" or "key" one level deep inside any object
  "*.secret",
  "*.key",
  // Body fields inside array elements
  "[*].secret",
  "[*].key",
];

const pinoConfig = {
  level: LOG_LEVEL,
  enabled: true,
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
};

// Pretty-print in development, JSON in production
const transport = !IS_PRODUCTION
  ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
        singleLine: false,
      },
    }
  : undefined;

const logger = pino(pinoConfig, transport ? pino.transport(transport) : undefined);

module.exports = logger;
