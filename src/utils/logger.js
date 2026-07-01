/**
 * Structured logger configuration using Pino.
 * Supports LOG_LEVEL env var to control verbosity.
 * Outputs JSON in production, pretty-printed in development.
 */

const pino = require("pino");

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const pinoConfig = {
  level: LOG_LEVEL,
  enabled: true,
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
