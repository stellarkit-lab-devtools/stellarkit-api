const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);
const { streamingServer: server } = require("../config/stellar");
const { StrKey } = require("@stellar/stellar-sdk");
const { formatTransaction } = require("../utils/formatTransaction");
const { normalizeAsset } = require("../utils/asset");
const { formatLedgerSequence } = require("../utils/formatLedgerSequence");
const webhookRegistry = require("../services/webhookRegistry");
const webhookDelivery = require("../services/webhookDelivery");

/**
 * Horizon paging tokens are numeric ("123456789-1" style for effects/ops,
 * plain digits for transactions/ledgers); "now" starts from the live edge.
 */
const STREAM_CURSOR_PATTERN = /^(now|\d+(-\d+)?)$/;

/**
 * Resolve the ?cursor= query param for a stream route.
 * Returns "now" when absent, the cursor when valid, or null when malformed.
 *
 * Clients resume a dropped stream by reconnecting with the `cursor` of the
 * last event they received; Horizon then replays everything after it, so no
 * events are duplicated or skipped across the reconnect.
 *
 * @param {object} query - Express req.query
 * @returns {string|null}
 */
function resolveStreamCursor(query) {
  const raw = query ? query.cursor : undefined;
  if (raw === undefined || raw === "") return "now";
  if (typeof raw !== "string" || !STREAM_CURSOR_PATTERN.test(raw)) return null;
  return raw;
}

function invalidCursorResponse(res, cursor) {
  return res.status(400).json({
    success: false,
    error: {
      type: "InvalidCursor",
      message: "The provided cursor value is invalid.",
      detail: `Received '${String(cursor).slice(0, 50)}'. Use the cursor of the last event you received, or "now".`,
    },
  });
}

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
 * Query params:
 *   - cursor (optional) — paging token of the last event received; the stream
 *     resumes after it. Defaults to "now" (live edge).
 *
 * Each transaction event carries the Horizon paging token as the SSE `id:`
 * and as a `cursor` field in the payload.
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

  // 3. Optional resume cursor
  const cursor = resolveStreamCursor(req.query);
  if (cursor === null) {
    return invalidCursorResponse(res, req.query.cursor);
  }

  // 4. Account existence check (optional but preferred)
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
    // Stream from the live edge, or resume after the client's last cursor
    streamClose = server
      .transactions()
      .forAccount(id)
      .cursor(cursor)
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

          // Format and send transaction event. The paging token is sent as
          // both the SSE id and a `cursor` field so clients can resume.
          const eventCursor = transaction.paging_token || null;
          const payload = { ...formatTransaction(transaction), cursor: eventCursor };
          if (eventCursor) res.write(`id: ${eventCursor}\n`);
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
 * Query params:
 *   - cursor (optional) — paging token of the last event received; the stream
 *     resumes after it. Defaults to "now" (live edge).
 *
 * SSE Events:
 *   - payment: JSON with { type, amount, asset, from, to, timestamp, cursor }
 *     (the paging token is also sent as the SSE `id:`)
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

  const cursor = resolveStreamCursor(req.query);
  if (cursor === null) {
    return invalidCursorResponse(res, req.query.cursor);
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
      .cursor(cursor)
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
            asset: normalizeAsset(op.asset_code, op.asset_issuer, op.asset_type),
            from: op.from || op.funder || op.source_account || null,
            to: op.to || op.account || null,
            timestamp: op.created_at || null,
            cursor: op.paging_token || null,
          };

          if (payload.cursor) res.write(`id: ${payload.cursor}\n`);
          res.write(`event: payment\n`);
          res.write(`data: ${JSON.stringify(payload)}\n\n`);

          // Trigger webhook delivery for payment.received events
          const webhooks = webhookRegistry.getWebhooks(id, "payment.received");
          if (webhooks.length > 0) {
            const webhookPayload = {
              event: "payment.received",
              accountId: id,
              payment: payload,
              timestamp: new Date().toISOString(),
            };

            webhookDelivery.triggerWebhooks(webhooks, webhookPayload).catch((err) => {
              logger.error(
                { accountId: id, error: err.message },
                "Error triggering webhook delivery"
              );
            });
          }
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

/**
 * GET /stream/ledgers
 * Server-Sent Events endpoint that streams real-time live Stellar ledger updates.
 */
router.get("/ledgers", async (req, res, next) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  // Send initial keep-alive comment line
  res.write(": keep-alive\n\n");

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(heartbeat);
      return;
    }
    res.write(": keep-alive\n\n");
  }, 15000);

  let closeHorizonStream;

  try {
    closeHorizonStream = server.ledgers().cursor("now").stream({
      onmessage: (ledger) => {
        if (res.writableEnded || res.destroyed) return;
        res.write(`data: ${JSON.stringify({
          sequence: formatLedgerSequence(ledger.sequence),
          closedAt: ledger.closed_at,
          baseFee: ledger.base_fee_in_stroops || ledger.base_fee,
          transactionCount: ledger.successful_transaction_count,
          operationCount: ledger.operation_count,
        })}\n\n`);
      },
      onerror: (err) => {
        clearInterval(heartbeat);
        if (!res.writableEnded && !res.destroyed) res.end();
        if (typeof closeHorizonStream === "function") {
          closeHorizonStream();
        }
      }
    });
  } catch (err) {
    clearInterval(heartbeat);
    if (!res.writableEnded && !res.destroyed) res.end();
    return;
  }

  req.on("close", () => {
    clearInterval(heartbeat);
    if (typeof closeHorizonStream === "function") {
      closeHorizonStream();
    }
  });
});

module.exports = router;
