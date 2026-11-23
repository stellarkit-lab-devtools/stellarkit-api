const DEFAULT_SLOW_MS = 2000;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Pings Horizon and returns connectivity status for GET /health.
 *
 * status:
 *   - "ok"          — Horizon responded within slowMs
 *   - "degraded"    — Horizon responded but slower than slowMs
 *   - "unreachable" — Horizon threw or timed out
 *
 * @param {object} options
 * @param {object} options.server - Stellar SDK Horizon.Server instance.
 * @param {string} options.network - Configured Stellar network name.
 * @param {number} [options.slowMs=2000]
 * @param {number} [options.timeoutMs=5000]
 * @returns {Promise<{ status: "ok"|"degraded"|"unreachable", responseTimeMs: number, network: string }>}
 */
async function getHorizonHealth({
  server,
  network,
  slowMs = DEFAULT_SLOW_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const startedAt = Date.now();
  let timer;

  try {
    const ping =
      server && typeof server.serverInfo === "function"
        ? server.serverInfo()
        : server.root();

    await Promise.race([
      ping,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Horizon health check timed out")),
          timeoutMs,
        );
      }),
    ]);

    const responseTimeMs = Date.now() - startedAt;
    return {
      status: responseTimeMs >= slowMs ? "degraded" : "ok",
      responseTimeMs,
      network,
    };
  } catch {
    return {
      status: "unreachable",
      responseTimeMs: Date.now() - startedAt,
      network,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  getHorizonHealth,
  DEFAULT_SLOW_MS,
  DEFAULT_TIMEOUT_MS,
};
