/**
 * Structured logger with configurable log levels.
 * Replaces inconsistent console.log/error usage throughout the codebase.
 * In production: JSON output. In development: readable format.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT_LEVEL = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;
const IS_PROD = process.env.NODE_ENV === 'production';

const log = (level, message, meta = {}) => {
  if (LEVELS[level] > CURRENT_LEVEL) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const output = IS_PROD ? JSON.stringify(entry) : `[${entry.timestamp}] ${level.toUpperCase()} ${message}${Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ""}`;
  if (level === 'error') process.stderr.write(output + '\n');
  else process.stdout.write(output + '\n');
};

const logger = {
  error: (msg, meta) => log('error', msg, meta),
  warn:  (msg, meta) => log('warn',  msg, meta),
  info:  (msg, meta) => log('info',  msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
};

module.exports = logger;
