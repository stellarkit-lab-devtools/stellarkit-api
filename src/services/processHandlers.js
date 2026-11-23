/**
 * Process Handlers for Unhandled Rejections and Uncaught Exceptions
 * 
 * Ensures unhandled rejections don't leave the process in an unknown state.
 * Logs a fatal entry with redacted stack and exits cleanly after a delay.
 */

const logger = require("../utils/logger");

const FATAL_EXIT_DELAY_MS = parseInt(process.env.FATAL_EXIT_DELAY_MS, 10) || 1000;
let handlersInstalled = false;
let exitScheduled = false;

function redactedStack(err) {
  if (!err || !err.stack) return "Unknown error";
  return err.stack
    .split("\n")
    .map(line => line.replace(/at\s+.*\/.*\.js:\d+:\d+/g, "at [redacted]:0:0"))
    .join("\n");
}

function scheduleExit() {
  if (exitScheduled) return;
  exitScheduled = true;
  setTimeout(() => {
    try {
      logger.fatal({ stack: redactedStack(new Error("Unhandled rejection")) }, "[FATAL] Unhandled rejection - exiting");
    } catch {
      console.error("[FATAL] Unhandled rejection - exiting");
    }
    process.exit(1);
  }, FATAL_EXIT_DELAY_MS);
}

function installProcessHandlers({ exit = process.exit } = {}) {
  if (handlersInstalled) return;
  handlersInstalled = true;

  process.on("unhandledRejection", (reason) => {
    try {
      const stack = reason instanceof Error ? redactedStack(reason) : String(reason);
      logger.fatal({ reason: String(reason), stack }, "[FATAL] Unhandled rejection detected");
    } catch {
      console.error("[FATAL] Unhandled rejection:", reason);
    }
    scheduleExit();
    exit(1);
  });

  process.on("uncaughtException", (err) => {
    try {
      logger.fatal({ stack: redactedStack(err) }, "[FATAL] Uncaught exception");
    } catch {
      console.error("[FATAL] Uncaught exception:", err);
    }
    exit(1);
  });
}

module.exports = { installProcessHandlers, FATAL_EXIT_DELAY_MS };