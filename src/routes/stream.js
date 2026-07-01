const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);
const { server } = require("../config/stellar");
const { StrKey } = require("@stellar/stellar-sdk");
const { formatTransaction } = require("../utils/formatTransaction");

/**
 * Error codes for SSE stream errors
 */
const STREAM_ERROR_CODES = {
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  INVALID_ACCOUNT_ID: "INVALID_ACCOUNT_ID",
  STREAM_ERROR: "STREAM_ERROR",
  HORIZON_UNAVAILABLE: "HORIZON_UNAVAILABLE",
};

/**
 * GET /stream/transactions/:id
 * Server-Sent Events endpoint that streams real-time transactions for a Stellar account.
 *
 * Path param:
 *   - id: Stellar account public key (G... address, 56 chars)
 *
 * SSE Events:
 *   - connected: Sent immediately after validation passes
 *   - transaction: Sent for each new transaction on the account
 *   - heartbeat: Sent every 25 seconds to keep connection alive
 *   - error: Sent before closing on fatal error
 *
 * @example
 * GET /stream/transactions/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 */
router.get("/transactions/:id", async (req, res, next) => {
  const { id } = req.params;

  // ── Validation Phase ────────────────────────────────────────────────────────
  // Validate before setting SSE headers

  // 1. Non-empty check
  if (!id) {
    return res.status(400).json({
      success: false,
      error: {
        type: "ValidationError",
        message: "Account ID is required",
      },
    });
  }

  // 2. Format check
  if (!StrKey.isValidEd25519PublicKey(id)) {
    return res.status(400).json({
      success: false,
      error: {
        type: "ValidationError",
        message: "Invalid Stellar account ID",
        detail: "Must be a valid G... address",
      },
    });
  }

  // 3. Account existence check (optional but preferred)
  try {
    await server.loadAccount(id);
  } catch (err) {
    // Check if it's an AccountNotFoundError (404 from Horizon)
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: {
          type: "NotFound",
          message: "Account not found",
          detail: "No Stellar account exists for this public key",
        },
      });
    }
    // For other network errors, log but proceed (don't fail the stream)
    if (process.env.NODE_ENV !== "test") {
      logger.warn({ accountId: id, error: err.message }, "Account existence check failed");
    }
  }

  // ── SSE Setup ───────────────────────────────────────────────────────────────
  // Set SSE headers after validation passes
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Log stream opened
  if (process.env.NODE_ENV !== "test") {
    logger.info({ accountId: id }, "Stream opened for account");
  }

  // Send connected event immediately
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({
    account: id,
    timestamp: new Date().toISOString(),
  })}\n\n`);

  // ── Horizon Stream Setup ────────────────────────────────────────────────────
  let streamClose;
  let heartbeatInterval;

  try {
    // Start streaming transactions from now onwards (not historical)
    streamClose = server
      .transactions()
      .forAccount(id)
      .cursor("now")
      .stream({
        onmessage: (transaction) => {
          // Check if client has disconnected
          if (res.writableEnded || res.destroyed) {
            streamClose();
            return;
          }

          // Log transaction (hash only, not full payload)
          if (process.env.NODE_ENV !== "test") {
            logger.debug({ txHash: transaction.hash }, "Transaction forwarded");
          }

          // Format and send transaction event
          const payload = formatTransaction(transaction);
          res.write(`event: transaction\n`);
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        },
        onerror: (error) => {
          // Log the error
          if (process.env.NODE_ENV !== "test") {
            logger.error({ accountId: id, error }, "Horizon stream error");
          }

          // Send error event if connection still open
          if (!res.writableEnded && !res.destroyed) {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({
              code: STREAM_ERROR_CODES.STREAM_ERROR,
              message: "Transaction stream encountered an error",
            })}\n\n`);
            res.end();
          }

          // Clean up
          streamClose();
          if (heartbeatInterval) clearInterval(heartbeatInterval);
        },
      });
  } catch (err) {
    // Catch any synchronous errors during stream setup
    if (process.env.NODE_ENV !== "test") {
      logger.error({ accountId: id, err }, "Failed to set up stream");
    }

    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({
        code: STREAM_ERROR_CODES.HORIZON_UNAVAILABLE,
        message: "Failed to connect to transaction stream",
      })}\n\n`);
      res.end();
    }
    return;
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────────
  // Send heartbeat every 25 seconds to keep connection alive through proxies
  heartbeatInterval = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(heartbeatInterval);
      return;
    }

    if (process.env.NODE_ENV !== "test") {
      logger.warn({ accountId: id }, "Heartbeat sent to potentially stale connection");
    }

    res.write(`event: heartbeat\n`);
    res.write(`data: ${JSON.stringify({
      timestamp: new Date().toISOString(),
    })}\n\n`);
  }, 25_000);

  // ── Client Disconnect Cleanup ───────────────────────────────────────────────
  req.on("close", () => {
    if (process.env.NODE_ENV !== "test") {
      logger.info({ accountId: id }, "Stream closed for account (client disconnect)");
    }

    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (streamClose) streamClose();
  });

  req.on("error", () => {
    if (process.env.NODE_ENV !== "test") {
      logger.info({ accountId: id }, "Stream closed for account (error)");
    }

    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (streamClose) streamClose();
  });
});

/**
 * GET /stream/payments/:id
 * SSE endpoint that streams incoming and outgoing payment events for a Stellar account.
 *
 * Filters to: payment, create_account operation types.
 *
 * SSE Events:
 *   - payment: JSON with { type, amount, assetCode, from, to, timestamp }
 *   - heartbeat comment (": ping"): every 30 seconds
 */
router.get("/payments/:id", async (req, res, next) => {
  const { id } = req.params;

  if (!StrKey.isValidEd25519PublicKey(id)) {
    return res.status(400).json({
      success: false,
      error: {
        type: "ValidationError",
        message: "Invalid Stellar account ID",
        detail: "Must be a valid G... address",
      },
    });
  }

  try {
    await server.loadAccount(id);
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: {
          type: "NotFound",
          message: "Account not found",
          detail: "No Stellar account exists for this public key",
        },
      });
    }
    if (process.env.NODE_ENV !== "test") {
      logger.warn({ accountId: id, error: err.message }, "Account check failed");
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");

  let closeStream;
  let heartbeatInterval;

  const PAYMENT_TYPES = new Set(["payment", "create_account"]);

  try {
    closeStream = server
      .payments()
      .forAccount(id)
      .cursor("now")
      .stream({
        onmessage: (op) => {
          if (res.writableEnded || res.destroyed) {
            closeStream && closeStream();
            return;
          }

          if (!PAYMENT_TYPES.has(op.type)) return;

          const payload = {
            type: op.type,
            amount: op.amount || op.starting_balance || null,
            assetCode: op.asset_type === "native" ? "XLM" : (op.asset_code || null),
            from: op.from || op.funder || op.source_account || null,
            to: op.to || op.account || null,
            timestamp: op.created_at || null,
          };

          res.write(`event: payment\n`);
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        },
        onerror: () => {
          if (!res.writableEnded && !res.destroyed) res.end();
          closeStream && closeStream();
          clearInterval(heartbeatInterval);
        },
      });
  } catch {
    if (!res.writableEnded && !res.destroyed) res.end();
    return;
  }

  heartbeatInterval = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(heartbeatInterval);
      return;
    }
    res.write(": ping\n\n");
  }, 30_000);

  req.on("close", () => {
    clearInterval(heartbeatInterval);
    closeStream && closeStream();
  });
});

module.exports = router;
