/**
 * Background readiness probe for GET /health/ready.
 *
 * Runs a Horizon ping on a fixed interval and remembers the result so that
 * readiness checks never trigger upstream calls themselves — the HTTP handler
 * reads the cached result only.
 *
 * State machine:
 *   "starting"   — no successful probe yet since process start
 *   "ready"      — last probe succeeded and is not stale
 *   "not_ready"  — last probe failed or the result is stale (> READINESS_MAX_AGE_MS old)
 */

const logger = require("../utils/logger");

const DEFAULT_MAX_AGE_MS = 30_000;
const DEFAULT_INTERVAL_MS = 10_000;

class ReadinessProbe {
  constructor({
    getServer = null,
    maxAgeMs = null,
    intervalMs = null,
  } = {}) {
    this._getServer = getServer;
    this._maxAgeMs =
      maxAgeMs ??
      (parseInt(process.env.READINESS_MAX_AGE_MS, 10) || DEFAULT_MAX_AGE_MS);
    this._intervalMs =
      intervalMs ??
      (parseInt(process.env.READINESS_PROBE_INTERVAL_MS, 10) || DEFAULT_INTERVAL_MS);

    // null = never ran, number = Date.now() of last success
    this._lastSuccessAt = null;
    // null = never ran, true/false = outcome of last probe
    this._lastProbeOk = null;
    this._timer = null;
    this._started = false;
  }

  /**
   * Start the background interval.  Safe to call multiple times — only the
   * first call has any effect.
   */
  start(serverOverride = null) {
    if (this._started) return;
    this._started = true;

    // Run immediately so the first ready check is answered quickly after boot.
    this._probe(serverOverride).catch(() => {});

    this._timer = setInterval(() => {
      this._probe(serverOverride).catch(() => {});
    }, this._intervalMs);

    // Don't hold the Node.js event loop open.
    if (this._timer.unref) this._timer.unref();
  }

  /** Stop the background interval (used in tests). */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._started = false;
  }

  /** Reset all state (used in tests). */
  reset() {
    this.stop();
    this._lastSuccessAt = null;
    this._lastProbeOk = null;
  }

  /**
   * Returns the current readiness status string:
   *   "starting"   — no probe has ever succeeded
   *   "ready"      — last success is within maxAgeMs
   *   "not_ready"  — last probe failed OR result is stale
   */
  getStatus() {
    // Never ran a probe → starting
    if (this._lastSuccessAt === null && this._lastProbeOk === null) return "starting";
    // Probe ran but never succeeded → not_ready
    if (this._lastSuccessAt === null) return "not_ready";
    // Have a success — check if it's still fresh
    const age = Date.now() - this._lastSuccessAt;
    if (age <= this._maxAgeMs) return "ready";
    return "not_ready";
  }

  /** @private */
  async _probe(serverOverride = null) {
    const srv = serverOverride ?? (this._getServer ? this._getServer() : null);
    if (!srv) {
      this._lastProbeOk = false;
      return;
    }

    try {
      const ping =
        typeof srv.serverInfo === "function" ? srv.serverInfo() : srv.root();
      await Promise.race([
        ping,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("probe timeout")), 5000)
        ),
      ]);
      this._lastSuccessAt = Date.now();
      this._lastProbeOk = true;
    } catch (err) {
      this._lastProbeOk = false;
      if (process.env.NODE_ENV !== "test") {
        logger.warn({ err: err?.message }, "Readiness probe failed");
      }
    }
  }
}

// Singleton exported for use in src/index.js
const probe = new ReadinessProbe();
module.exports = probe;
module.exports.ReadinessProbe = ReadinessProbe;
