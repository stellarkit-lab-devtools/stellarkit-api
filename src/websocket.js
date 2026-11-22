const { WebSocketServer } = require("ws");
const logger = require("./utils/logger");
const { streamingServer: stellarServer } = require("./config/stellar");
const { formatLedgerSequence } = require("./utils/formatLedgerSequence");

/** Ledger paging tokens are numeric; "now" starts from the live edge. */
const LEDGER_CURSOR_PATTERN = /^(now|\d+)$/;

/**
 * Sets up the WebSocket server attached to the existing HTTP server.
 *
 * WS /stream/ledgers[?cursor=<paging_token>] — streams ledger closes. Each
 * message includes a `cursor` (the ledger paging token); reconnect with
 * ?cursor=<last cursor> to resume without gaps or duplicates.
 *
 * @param {import("http").Server} server - The HTTP server instance.
 * @returns {import("ws").Server} The WebSocket server instance.
 */
function setupWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    // Handle path-based routing specifically for /stream/ledgers
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/stream/ledgers") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws, req) => {
    logger.info(`Client connected to /stream/ledgers from ${req.socket.remoteAddress}`);

    // Optional ?cursor= lets a reconnecting client resume after the last
    // ledger it received (each message carries its paging token as `cursor`).
    let cursor = null;
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      cursor = url.searchParams.get("cursor");
    } catch (_) {
      cursor = null;
    }
    if (cursor !== null && cursor !== "" && !LEDGER_CURSOR_PATTERN.test(cursor)) {
      ws.close(1008, "Invalid cursor");
      return;
    }

    // isClosed is a race-condition guard. Both the "close" and "error" events can fire
    // in quick succession (or even concurrently in the event loop). Without this flag,
    // cleanup() could run twice: the second call would try to invoke closeHorizonStream
    // on an already-torn-down stream, potentially throwing or emitting spurious errors.
    let isClosed = false;

    // closeHorizonStream holds the unsubscribe function returned by stellarServer.ledgers().stream().
    // It is declared here so both the stream setup block and the cleanup function share the same
    // reference. If stream() throws synchronously, closeHorizonStream stays undefined and cleanup
    // guards against that with the typeof check below.
    let closeHorizonStream;

    try {
      // Subscribe to Horizon live ledger stream. stellarServer.ledgers().stream() returns a
      // teardown function that stops the EventSource-style connection when called.
      const ledgersQuery = cursor
        ? stellarServer.ledgers().cursor(cursor)
        : stellarServer.ledgers();
      closeHorizonStream = ledgersQuery.stream({
        onmessage: (ledger) => {
          // Guard against messages arriving after the client has already disconnected.
          // Without this check, we would attempt to JSON.stringify and ws.send to a closed
          // socket, which wastes CPU and may emit unnecessary error events.
          if (isClosed) return;
          try {
            // Transform raw Horizon ledger structure into desired JSON schema
            const message = {
              sequence: formatLedgerSequence(ledger.sequence),
              closedAt: ledger.closed_at,
              baseFee: ledger.base_fee_in_stroops,
              transactionCount: ledger.successful_transaction_count,
            };
            // Paging token used by clients to resume via ?cursor=
            if (ledger.paging_token !== undefined && ledger.paging_token !== null) {
              message.cursor = String(ledger.paging_token);
            }
            const payload = JSON.stringify(message);

            // ws.readyState can transition to CLOSING or CLOSED between the isClosed check above
            // and this send call (e.g. if the client disconnects mid-message). Checking OPEN here
            // prevents a "WebSocket is not open" error from being thrown by ws.send().
            if (ws.readyState === ws.OPEN) {
              ws.send(payload);
            }
          } catch (err) {
            logger.error({ err }, "Error formatting or sending ledger update");
          }
        },
        onerror: (error) => {
          // The Horizon stream can emit errors mid-connection (e.g. network blip, Horizon restart).
          // Logging here keeps the error visible without crashing the Node process. The stream will
          // attempt to reconnect automatically via the underlying EventSource retry logic; we do not
          // close the WebSocket so the client stays connected through transient Horizon issues.
          logger.error({ error }, "Stellar Horizon ledger stream error");
        },
      });
    } catch (err) {
      logger.error({ err }, "Failed to start Stellar Horizon stream");
      ws.close(1011, "Horizon stream subscription failed");
      return;
    }

    const cleanup = () => {
      // isClosed prevents double-cleanup when both "close" and "error" events fire for
      // the same disconnection. Set it immediately so any in-flight onmessage callbacks
      // that check isClosed will also see the closed state.
      if (isClosed) return;
      isClosed = true;
      logger.info("Client disconnected from /stream/ledgers. Unsubscribing Horizon stream.");

      // Calling closeHorizonStream() stops the Horizon SSE/EventSource subscription.
      // Without this call, the stream would continue running in the background, consuming
      // memory and network resources, and buffering ledger events for a client that is gone.
      if (typeof closeHorizonStream === "function") {
        try {
          closeHorizonStream();
        } catch (err) {
          logger.error({ err }, "Error unsubscribing from Horizon stream");
        }
      }
    };

    ws.on("close", cleanup);
    ws.on("error", (err) => {
      logger.error({ err }, "Client socket error");
      cleanup();
    });
  });

  return wss;
}

module.exports = { setupWebSocket };
