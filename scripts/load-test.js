#!/usr/bin/env node
/**
 * scripts/load-test.js
 *
 * Load-test StellarKit API using autocannon.
 *
 * Usage:
 *   node scripts/load-test.js [options]
 *
 * Options:
 *   --url <url>           Base URL of the API to test (default: http://localhost:3000)
 *   --connections <n>     Number of concurrent connections (default: 10)
 *   --duration <s>        Duration of each scenario in seconds (default: 10)
 *   --mock-horizon        Start a local stub Horizon server so results measure the
 *                         API itself rather than the network.  Automatically sets
 *                         HORIZON_URL to the stub and launches the API in-process.
 *
 * Examples:
 *   # Test an already-running local server
 *   node scripts/load-test.js --url http://localhost:3000 --connections 20 --duration 15
 *
 *   # Self-contained run with a stub Horizon (no live network required)
 *   node scripts/load-test.js --mock-horizon --connections 10 --duration 10
 */

"use strict";

const http = require("http");
const autocannon = require("autocannon");

// ── Argument parsing ─────────────────────────────────────────────────────────

/**
 * Parse CLI arguments into a plain options object.
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{ url: string, connections: number, duration: number, mockHorizon: boolean }}
 */
function parseArgs(argv) {
  const opts = {
    url: "http://localhost:3000",
    connections: 10,
    duration: 10,
    mockHorizon: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url" && argv[i + 1]) {
      opts.url = argv[++i];
    } else if (arg === "--connections" && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (!Number.isInteger(n) || n < 1) {
        console.error("--connections must be a positive integer");
        process.exit(1);
      }
      opts.connections = n;
    } else if (arg === "--duration" && argv[i + 1]) {
      const s = parseInt(argv[++i], 10);
      if (!Number.isInteger(s) || s < 1) {
        console.error("--duration must be a positive integer (seconds)");
        process.exit(1);
      }
      opts.duration = s;
    } else if (arg === "--mock-horizon") {
      opts.mockHorizon = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
StellarKit Load Test
Usage: node scripts/load-test.js [options]

Options:
  --url <url>           Base URL of the API to test (default: http://localhost:3000)
  --connections <n>     Concurrent connections per scenario (default: 10)
  --duration <s>        Duration per scenario in seconds (default: 10)
  --mock-horizon        Start a local stub Horizon + API server automatically
  -h, --help            Show this help
`);
}

// ── Summary formatting ───────────────────────────────────────────────────────

/**
 * Format an autocannon result into a human-readable summary table.
 * @param {string} label - Scenario label (e.g. "GET /health")
 * @param {object} result - Autocannon result object
 * @returns {string}
 */
function formatSummary(label, result) {
  const lat = result.latency;
  const rps = result.requests.average;
  const errors = result.errors + result.timeouts;
  const totalReqs = result.requests.total;

  return [
    `  Scenario : ${label}`,
    `  Requests : ${totalReqs} total  |  ${rps.toFixed(1)} req/s`,
    `  Latency  : p50=${lat.p50}ms  p95=${lat.p95}ms  p99=${lat.p99}ms  max=${lat.max}ms`,
    `  Errors   : ${errors}`,
  ].join("\n");
}

// ── Stub Horizon server ──────────────────────────────────────────────────────

/**
 * Start a minimal HTTP stub server that responds to the Horizon endpoints
 * StellarKit uses during startup cache-warming and health checks.
 *
 * @returns {Promise<{ server: http.Server, port: number }>}
 */
function startStubHorizon() {
  return new Promise((resolve, reject) => {
    const stubServer = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/" || req.url === "") {
        // Horizon root — used by getHorizonHealth
        res.writeHead(200);
        res.end(JSON.stringify({
          horizon_version: "stub-2.0.0",
          core_version: "stellar-core stub",
          network_passphrase: "Test SDF Network ; September 2015",
          core_latest_ledger: 50000,
          history_latest_ledger: 50000,
          history_elder_ledger: 1,
          current_protocol_version: 20,
          _links: { self: { href: "" } },
        }));
        return;
      }

      if (req.url === "/fee_stats") {
        // Used by warmFeeEstimateCache
        const stat = "100";
        res.writeHead(200);
        res.end(JSON.stringify({
          last_ledger: "50000",
          last_ledger_base_fee: "100",
          ledger_capacity_usage: "0.5",
          fee_charged: { min: stat, mode: stat, p10: stat, p20: stat, p30: stat, p40: stat, p50: stat, p60: stat, p70: stat, p80: stat, p90: stat, p95: stat, p99: stat, max: stat },
          max_fee: { min: stat, mode: stat, p10: stat, p20: stat, p30: stat, p40: stat, p50: stat, p60: stat, p70: stat, p80: stat, p90: stat, p95: stat, p99: stat, max: stat },
        }));
        return;
      }

      if (req.url && req.url.startsWith("/accounts/")) {
        // Stub account lookup for GET /account/:id
        const accountId = req.url.split("/")[2]?.split("?")[0] ?? "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
        res.writeHead(200);
        res.end(JSON.stringify({
          id: accountId,
          account_id: accountId,
          sequence: "100",
          subentry_count: 0,
          thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
          flags: { auth_required: false, auth_revocable: false },
          balances: [{ balance: "10000.0000000", asset_type: "native" }],
          signers: [{ key: accountId, weight: 1, type: "ed25519_public_key" }],
          data: {},
          last_modified_ledger: 50000,
          last_modified_time: new Date().toISOString(),
        }));
        return;
      }

      // Fallback 404 for anything else
      res.writeHead(404);
      res.end(JSON.stringify({ type: "not_found", title: "Not Found", status: 404 }));
    });

    stubServer.listen(0, "127.0.0.1", () => {
      const { port } = stubServer.address();
      resolve({ server: stubServer, port });
    });
    stubServer.once("error", reject);
  });
}

// ── Autocannon runner ────────────────────────────────────────────────────────

/**
 * Run a single autocannon benchmark for a given path.
 * @param {string} baseUrl
 * @param {string} path
 * @param {number} connections
 * @param {number} duration
 * @returns {Promise<object>} autocannon result
 */
function runScenario(baseUrl, path, connections, duration) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: `${baseUrl}${path}`,
        connections,
        duration,
        pipelining: 1,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      },
    );
    autocannon.track(instance, { renderProgressBar: false });
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let stubHorizonServer = null;
  let apiServer = null;
  let targetUrl = opts.url;

  if (opts.mockHorizon) {
    // Start stub Horizon
    console.log("\n📡  Starting stub Horizon server…");
    const { server, port } = await startStubHorizon();
    stubHorizonServer = server;
    process.env.HORIZON_URL = `http://127.0.0.1:${port}`;
    process.env.STELLAR_NETWORK = "testnet";
    console.log(`    Stub Horizon listening on port ${port}`);

    // Start the actual StellarKit API in-process
    console.log("🚀  Starting StellarKit API…");
    const { startServer } = require("../src/index");
    const silentLogger = { log: () => {}, error: () => {} };
    apiServer = startServer({ port: 0, logger: silentLogger });
    await new Promise((resolve) => apiServer.once("listening", resolve));
    const apiPort = apiServer.address().port;
    targetUrl = `http://127.0.0.1:${apiPort}`;
    console.log(`    API listening on port ${apiPort}`);

    // Brief pause to allow cache warming to settle
    await new Promise((r) => setTimeout(r, 1500));
  }

  const scenarios = [
    { label: "GET /health", path: "/health" },
    { label: "GET /fee-estimate (cached)", path: "/fee-estimate" },
    { label: `GET /account/:id`, path: "/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
  ];

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  StellarKit Load Test`);
  console.log(`  Target      : ${targetUrl}`);
  console.log(`  Connections : ${opts.connections}`);
  console.log(`  Duration    : ${opts.duration}s per scenario`);
  console.log(`${"═".repeat(60)}\n`);

  const results = [];
  for (const scenario of scenarios) {
    console.log(`▶  ${scenario.label}`);
    try {
      const result = await runScenario(targetUrl, scenario.path, opts.connections, opts.duration);
      const summary = formatSummary(scenario.label, result);
      console.log(summary);
      results.push({ label: scenario.label, result });
    } catch (err) {
      console.error(`   Error running scenario: ${err.message}`);
    }
    console.log();
  }

  console.log(`${"═".repeat(60)}`);
  console.log("  Summary");
  console.log(`${"─".repeat(60)}`);
  console.log(`  ${"Scenario".padEnd(32)} ${"p50".padEnd(8)} ${"p95".padEnd(8)} ${"p99".padEnd(8)} ${"req/s".padEnd(8)} Errors`);
  console.log(`  ${"─".repeat(32)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)} ─────`);
  for (const { label, result } of results) {
    const lat = result.latency;
    const rps = result.requests.average.toFixed(1);
    const errs = result.errors + result.timeouts;
    console.log(
      `  ${label.padEnd(32)} ${String(lat.p50 + "ms").padEnd(8)} ${String(lat.p95 + "ms").padEnd(8)} ${String(lat.p99 + "ms").padEnd(8)} ${rps.padEnd(8)} ${errs}`,
    );
  }
  console.log(`${"═".repeat(60)}\n`);
  console.log(`  Hardware: ${process.platform} — Node.js ${process.version}`);
  console.log(`  See docs/performance.md for the recorded baseline table.\n`);

  // Cleanup
  if (apiServer) await new Promise((r) => apiServer.close(r));
  if (stubHorizonServer) await new Promise((r) => stubHorizonServer.close(r));
}

main().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
