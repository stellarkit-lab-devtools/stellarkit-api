#!/usr/bin/env node
"use strict";

// Checks consume snapshots, not process globals or live services. I/O lives in collect().
const result = (name, ok, fix) => ({ name, status: ok ? "PASS" : "FAIL", fix });
const PASSPHRASES = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
};
function checkNode({ nodeVersion, engines }) {
  // package.json currently declares a minimum Node version.
  const minimum = /^>=([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(engines.node || "");
  const actual = /^v?([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(nodeVersion || "");
  const number = parts => parts.slice(1).reduce((n, part) => n * 100000 + Number(part), 0);
  return result("node", !!(minimum && actual && number(actual) >= number(minimum)), "Install Node " + engines.node + ".");
}
function checkEnv({ envPresent, env }) {
  return result("env", envPresent && !!env.STELLAR_NETWORK && !!env.PORT,
    "Copy .env.example to .env and set STELLAR_NETWORK and PORT.");
}
function checkNetwork({ env }) {
  return result("network", Object.hasOwn(PASSPHRASES, env.STELLAR_NETWORK), "Set STELLAR_NETWORK to testnet or mainnet.");
}
function checkHorizon({ env, horizon }) {
  return result("horizon", !!(horizon && horizon.ok && PASSPHRASES[env.STELLAR_NETWORK] && horizon.data.network_passphrase === PASSPHRASES[env.STELLAR_NETWORK]),
    "Set HORIZON_URL to a reachable Horizon for STELLAR_NETWORK.");
}
function checkSoroban({ soroban }) {
  return result("soroban", !!(soroban && soroban.ok && soroban.data.result && soroban.data.result.status === "healthy"),
    "Set SOROBAN_RPC_URL to a reachable, healthy Soroban RPC server.");
}
function checkPort({ env, portFree }) {
  return result("port", /^[0-9]+$/.test(env.PORT || "") && Number(env.PORT) > 0 && Number(env.PORT) <= 65535 && portFree,
    "Set PORT to an unused port between 1 and 65535 or stop the process using it.");
}
function checkFriendbot({ env, friendbot }) {
  if (env.STELLAR_NETWORK !== "testnet") return { name: "friendbot", status: "WARN", fix: "Friendbot is testnet only; no action needed on mainnet." };
  return result("friendbot", !!(friendbot && friendbot.ok), "Check connectivity to https://friendbot.stellar.org.");
}
function checkDependencies({ manifest, lock, installed }) {
  const lockedRoot = lock && lock.packages && lock.packages[""];
  const matching = lockedRoot && ["dependencies", "devDependencies"].every(group => {
    const expected = manifest[group] || {};
    const locked = lockedRoot[group] || {};
    return Object.keys(expected).length === Object.keys(locked).length && Object.entries(expected).every(([name, range]) => locked[name] === range);
  });
  const entries = lock && lock.packages ? Object.entries(lock.packages).filter(([path, pkg]) => path && !pkg.link) : [];
  const present = entries.length > 0 && entries.every(([path, pkg]) =>
    (pkg.optional && installed[path] === undefined) || installed[path] === pkg.version);
  return result("dependencies", !!(matching && present), "Run npm ci to install dependencies matching package-lock.json.");
}
const checks = [checkNode, checkEnv, checkNetwork, checkHorizon, checkSoroban, checkPort, checkFriendbot, checkDependencies];
function diagnose(snapshot) {
  const results = checks.map(check => check(snapshot));
  const summary = { PASS: 0, WARN: 0, FAIL: 0 };
  results.forEach(item => summary[item.status]++);
  return { checks: results, summary, exitCode: summary.FAIL ? 1 : 0 };
}
function format(report, json = false) {
  if (json) return JSON.stringify(report, null, 2);
  return report.checks.map(item => item.status + " " + item.name + ": " + item.fix).join("\n") +
    "\nSummary: " + report.summary.PASS + " PASS, " + report.summary.WARN + " WARN, " + report.summary.FAIL + " FAIL";
}
async function collect({ cwd = process.cwd(), env = process.env, nodeVersion = process.version, fetchImpl = globalThis.fetch } = {}) {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const net = require("node:net");
  const readJson = async file => { try { return JSON.parse(await fs.readFile(path.join(cwd, file), "utf8")); } catch (_) { return null; } };
  const manifest = await readJson("package.json") || { engines: {} };
  const lock = await readJson("package-lock.json");
  let envPresent = false;
  const fileEnv = {};
  try {
    const text = await fs.readFile(path.join(cwd, ".env"), "utf8");
    envPresent = true;
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (match) {
        const raw = match[2];
        fileEnv[match[1]] = /^["']/.test(raw) ? raw.slice(1, raw.lastIndexOf(raw[0])) : raw.split("#")[0].trim();
      }
    }
  } catch (_) { /* reported by checkEnv */ }
  const configured = { ...fileEnv, ...env };
  const probe = async (url, options) => {
    if (!url) return { ok: false };
    try {
      const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(5000) });
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok, data };
    } catch (_) { return { ok: false }; }
  };
  const network = configured.STELLAR_NETWORK;
  const horizonUrl = configured.HORIZON_URL || ({ testnet: "https://horizon-testnet.stellar.org", mainnet: "https://horizon.stellar.org" })[network];
  const rpcUrl = configured.SOROBAN_RPC_URL || (network === "testnet" ? "https://soroban-testnet.stellar.org" : undefined);
  const [horizon, soroban, friendbot] = await Promise.all([
    probe(horizonUrl),
    probe(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }) }),
    network === "testnet" ? probe("https://friendbot.stellar.org/health") : null,
  ]);
  const port = Number(configured.PORT);
  const portFree = Number.isInteger(port) && port > 0 && port <= 65535 ? await new Promise(resolve => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  }) : false;
  const installed = {};
  for (const packagePath of Object.keys((lock && lock.packages) || {})) {
    if (packagePath) {
      const pkg = await readJson(packagePath + "/package.json");
      if (pkg) installed[packagePath] = pkg.version;
    }
  }
  return { nodeVersion, engines: manifest.engines || {}, envPresent, env: configured, manifest, lock, installed, horizon, soroban, friendbot, portFree };
}
async function main({ collectSnapshot = collect, write = console.log, json = process.argv.includes("--json") } = {}) {
  const report = diagnose(await collectSnapshot());
  write(format(report, json));
  return report.exitCode;
}
if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    console.error("FAIL doctor: Unable to inspect setup; check file permissions and configuration.");
    process.exitCode = 1;
  });
}
module.exports = { checkNode, checkEnv, checkNetwork, checkHorizon, checkSoroban, checkPort, checkFriendbot, checkDependencies, diagnose, format, collect, main };
