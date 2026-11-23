/**
 * Global request timeout middleware.
 *
 * A hung upstream call must not pin an API connection forever. Every request
 * gets a timer of REQUEST_TIMEOUT_MS (default 30000). When it fires before the
 * headers have been sent, a clear 504 RequestTimeout response is written.
 *
 * Exempt:
 *   - /stream/* routes (Server-Sent Events are intentionally long-lived)
 *   - WebSocket upgrade requests
 *
 * The timer is cleared on both `finish` and `close`, and a `timedOut` flag is
 * installed so any handler that completes late cannot try to write a second
 * response (which would otherwise surface as "headers already sent").
 */

const DEFAULT_TIMEOUT_MS = 30000;

function parseTimeoutMs(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function createRequestTimeout({ timeoutMs = parseTimeoutMs(process.env.REQUEST_TIMEOUT_MS) } = {}) {
  return function requestTimeout(req, res, next) {
    // Streaming and WebSocket upgrades are deliberately long-lived.
    if (
      (req.path && req.path.startsWith("/stream")) ||
      (req.originalUrl && req.originalUrl.startsWith("/stream")) ||
      (req.headers && typeof req.headers.upgrade === "string") ||
      (req.headers && req.headers.upgrade === "websocket")
    ) {
      return next();
    }

    let timer = null;
    req.timedOut = false;

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    // Guard late writes from handlers that finish after the 504 was sent.
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const guardedWrite = (original) =>
      function guarded(...args) {
        // `__timeoutWriting` lets the middleware itself send the 504 through
        // Express while all later handler writes stay suppressed.
        if (req.timedOut && !res.__timeoutWriting) return res;
        return original(...args);
      };
    res.json = guardedWrite(originalJson);
    res.send = guardedWrite(originalSend);

    res.once("finish", clear);
    res.once("close", clear);

    timer = setTimeout(() => {
      timer = null;
      if (res.headersSent || res.writableEnded) return;

      req.timedOut = true;
      const requestId = req.requestId || req.id || null;
      const message = `Request timed out after ${timeoutMs}ms`;

      // Literal shape from the API contract, plus the standard error envelope
      // so existing clients can read it the same way as every other error.
      res.__timeoutWriting = true;
      try {
        res.status(504).json({
          type: "RequestTimeout",
          message,
          requestId,
          success: false,
          error: { type: "RequestTimeout", message, requestId },
        });
      } finally {
        res.__timeoutWriting = false;
      }
    }, timeoutMs);

    // Do not hold the event loop open solely for the timeout in short tests.
    if (typeof timer.unref === "function") timer.unref();

    return next();
  };
}

const requestTimeout = createRequestTimeout();

module.exports = requestTimeout;
module.exports.createRequestTimeout = createRequestTimeout;
module.exports.DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
