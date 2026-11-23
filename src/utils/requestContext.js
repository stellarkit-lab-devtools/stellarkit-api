/**
 * Request-scoped logging context backed by Node's AsyncLocalStorage.
 *
 * Services and utilities can log without receiving `req`: any code running
 * inside a request (including after awaits, setTimeout and promise chains)
 * can read the current { requestId, method, route } via getRequestContext().
 * The shared logger merges this context into every log entry automatically.
 */
const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

/** Run `callback` with a request context attached to the async execution tree. */
function runWithRequestContext(context, callback) {
  return storage.run(context || {}, callback);
}

/** @returns {object|undefined} The context for the current async resource. */
function getRequestContext() {
  return storage.getStore();
}

/**
 * Express middleware: stores { requestId, method, route } for the request.
 * Place it immediately after the request-ID middleware.
 */
function requestContextMiddleware(req, res, next) {
  const context = {
    requestId: req.requestId,
    method: req.method,
    route: (req.baseUrl || "") + (req.route && req.route.path ? req.route.path : (req.path || req.originalUrl || "")),
  };
  storage.run(context, () => next());
}

module.exports = {
  runWithRequestContext,
  getRequestContext,
  requestContextMiddleware,
};
