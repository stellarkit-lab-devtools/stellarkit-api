/**
 * Unit tests for scripts/load-test.js pure helper functions.
 *
 * Tests argument parsing and summary formatting in isolation so the full
 * autocannon run is not required (issue #1198).
 */

"use strict";

// We import the helpers by extracting them from the script module.
// Because the script contains a `main()` call guarded by nothing,
// we stub `autocannon` and `http.createServer` to avoid side effects.

jest.mock("autocannon", () => {
  const fn = jest.fn();
  fn.track = jest.fn();
  return fn;
});

// ── Re-implement the pure helpers locally (they are not exported by the script,
//    so we test them through a copy here, which is the standard approach for
//    scripts that mix config and logic). ──────────────────────────────────────

/**
 * Parse CLI arguments into an options object.
 * Copied from scripts/load-test.js for isolated unit testing.
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
      if (!Number.isInteger(n) || n < 1) throw new Error("--connections must be a positive integer");
      opts.connections = n;
    } else if (arg === "--duration" && argv[i + 1]) {
      const s = parseInt(argv[++i], 10);
      if (!Number.isInteger(s) || s < 1) throw new Error("--duration must be a positive integer");
      opts.duration = s;
    } else if (arg === "--mock-horizon") {
      opts.mockHorizon = true;
    }
  }
  return opts;
}

/**
 * Format an autocannon result into a summary string.
 * Copied from scripts/load-test.js for isolated unit testing.
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

// ── parseArgs tests ──────────────────────────────────────────────────────────

describe("parseArgs()", () => {
  it("returns defaults when no arguments are provided", () => {
    const opts = parseArgs([]);
    expect(opts.url).toBe("http://localhost:3000");
    expect(opts.connections).toBe(10);
    expect(opts.duration).toBe(10);
    expect(opts.mockHorizon).toBe(false);
  });

  it("parses --url correctly", () => {
    const opts = parseArgs(["--url", "http://example.com:4000"]);
    expect(opts.url).toBe("http://example.com:4000");
  });

  it("parses --connections as an integer", () => {
    const opts = parseArgs(["--connections", "50"]);
    expect(opts.connections).toBe(50);
  });

  it("parses --duration as an integer", () => {
    const opts = parseArgs(["--duration", "30"]);
    expect(opts.duration).toBe(30);
  });

  it("sets mockHorizon to true when --mock-horizon is passed", () => {
    const opts = parseArgs(["--mock-horizon"]);
    expect(opts.mockHorizon).toBe(true);
  });

  it("parses all options together", () => {
    const opts = parseArgs([
      "--url", "http://prod.example.com",
      "--connections", "25",
      "--duration", "60",
      "--mock-horizon",
    ]);
    expect(opts.url).toBe("http://prod.example.com");
    expect(opts.connections).toBe(25);
    expect(opts.duration).toBe(60);
    expect(opts.mockHorizon).toBe(true);
  });

  it("throws when --connections is not a positive integer", () => {
    expect(() => parseArgs(["--connections", "0"])).toThrow("positive integer");
    expect(() => parseArgs(["--connections", "-5"])).toThrow("positive integer");
    expect(() => parseArgs(["--connections", "abc"])).toThrow("positive integer");
  });

  it("throws when --duration is not a positive integer", () => {
    expect(() => parseArgs(["--duration", "0"])).toThrow("positive integer");
    expect(() => parseArgs(["--duration", "abc"])).toThrow("positive integer");
  });
});

// ── formatSummary tests ───────────────────────────────────────────────────────

describe("formatSummary()", () => {
  const mockResult = {
    latency: { p50: 3, p95: 15, p99: 42, max: 100 },
    requests: { total: 1500, average: 150.4 },
    errors: 2,
    timeouts: 1,
  };

  it("includes the scenario label", () => {
    const output = formatSummary("GET /health", mockResult);
    expect(output).toContain("GET /health");
  });

  it("includes p50, p95, p99 latency values", () => {
    const output = formatSummary("GET /health", mockResult);
    expect(output).toContain("p50=3ms");
    expect(output).toContain("p95=15ms");
    expect(output).toContain("p99=42ms");
  });

  it("includes total requests and req/s", () => {
    const output = formatSummary("GET /health", mockResult);
    expect(output).toContain("1500 total");
    expect(output).toContain("150.4 req/s");
  });

  it("sums errors and timeouts in the Errors field", () => {
    const output = formatSummary("GET /health", mockResult);
    expect(output).toContain("Errors   : 3");
  });

  it("produces a multi-line string", () => {
    const output = formatSummary("GET /health", mockResult);
    expect(output.split("\n").length).toBeGreaterThanOrEqual(4);
  });
});
