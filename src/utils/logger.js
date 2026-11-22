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
const redactSeeds = require("./redactSeeds");

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
  hooks: { logMethod(args, method) { method.apply(this, args.map(redactSeeds)); } },
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

const rawLogger = pino(pinoConfig, transport ? pino.transport(transport) : undefined);
const { getRequestContext } = require("./requestContext");

/**
 * Merge the current AsyncLocalStorage request context into every log entry.
 * Services without `req` therefore still emit requestId/method/route. Entries
 * explicitly carrying a field take precedence over the inherited context.
 */
function withRequestContext(firstArg) {
  const context = getRequestContext();
  if (!context || Object.keys(context).length === 0) return firstArg;
  return { ...context, ...(firstArg || {}) };
}

// Pino methods rely on `this`, so call them on the raw logger. The exported
// object is a decorator, preserving the existing logger API/signatures.
const logger = Object.create(rawLogger);
for (const level of ["trace", "debug", "info", "warn", "error", "fatal"]) {
  logger[level] = function logWithContext(...args) {
    if (args[0] !== null && typeof args[0] === "object" && !Array.isArray(args[0]) && !(args[0] instanceof Error)) {
      args[0] = withRequestContext(args[0]);
    } else {
      args.unshift(withRequestContext({}));
    }
    return rawLogger[level].apply(rawLogger, args);
  };
}

// Exposed for tests that need to observe the final structured log entry.
logger.__rawLogger = rawLogger;

module.exports = logger;
