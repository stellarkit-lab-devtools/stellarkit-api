#!/usr/bin/env node
/**
 * verify-exports.cjs
 *
 * Verifies that the SDK exports map works for both CommonJS (require) and
 * ESM (dynamic import) consumers on Node 18 and 20.
 *
 * Usage (from the sdk/ directory after building):
 *   node scripts/verify-exports.cjs
 *
 * This is a manual smoke-test script, not part of the CI pipeline.
 * Run it after `npm run build` to confirm the dist artefacts are correct.
 */

"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");

const SDK_DIR = path.resolve(__dirname, "..");
const CJS_MAIN = path.join(SDK_DIR, "dist", "cjs", "stellarkit-client.js");
const ESM_MAIN = path.join(SDK_DIR, "dist", "esm", "stellarkit-client.js");
const CJS_SOROBAN = path.join(SDK_DIR, "dist", "cjs", "soroban.js");
const ESM_SOROBAN = path.join(SDK_DIR, "dist", "esm", "soroban.js");

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${label}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${label}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

console.log("\nStellarKit SDK — exports verification\n");

// ── 1. Build output exists ───────────────────────────────────────────────────
console.log("1. Build artefacts exist");
check("dist/cjs/stellarkit-client.js", () => assert.ok(fs.existsSync(CJS_MAIN), "Missing CJS main"));
check("dist/esm/stellarkit-client.js", () => assert.ok(fs.existsSync(ESM_MAIN), "Missing ESM main"));
check("dist/cjs/soroban.js",           () => assert.ok(fs.existsSync(CJS_SOROBAN), "Missing CJS soroban"));
check("dist/esm/soroban.js",           () => assert.ok(fs.existsSync(ESM_SOROBAN), "Missing ESM soroban"));

// ── 2. CJS require works ─────────────────────────────────────────────────────
console.log("\n2. CommonJS (require)");
check("require CJS StellarKitClient", () => {
  const { StellarKitClient } = require(CJS_MAIN);
  assert.strictEqual(typeof StellarKitClient, "function", "StellarKitClient should be a constructor");
});

check("StellarKitClient can be instantiated via require", () => {
  const { StellarKitClient } = require(CJS_MAIN);
  const client = new StellarKitClient({ baseUrl: "http://localhost:3000" });
  assert.strictEqual(typeof client.getHealth, "function");
  assert.strictEqual(typeof client.getSorobanTransaction, "function");
});

check("require CJS SorobanModule", () => {
  const { SorobanModule } = require(CJS_SOROBAN);
  assert.strictEqual(typeof SorobanModule, "function", "SorobanModule should be a constructor");
});

check("SorobanModule can be instantiated via require", () => {
  const { SorobanModule } = require(CJS_SOROBAN);
  const soroban = new SorobanModule({ baseUrl: "http://localhost:3000" });
  assert.strictEqual(typeof soroban.getContract, "function");
  assert.strictEqual(typeof soroban.getContractStorage, "function");
  assert.strictEqual(typeof soroban.getTransaction, "function");
});

// ── 3. ESM dynamic import works ──────────────────────────────────────────────
async function runEsmChecks() {
  console.log("\n3. ESM (dynamic import)");

  await checkAsync("import() ESM StellarKitClient", async () => {
    const mod = await import(`file://${ESM_MAIN}`);
    assert.strictEqual(typeof mod.StellarKitClient, "function", "StellarKitClient not exported from ESM");
  });

  await checkAsync("StellarKitClient can be instantiated via import()", async () => {
    const { StellarKitClient } = await import(`file://${ESM_MAIN}`);
    const client = new StellarKitClient({ baseUrl: "http://localhost:3000" });
    assert.strictEqual(typeof client.getHealth, "function");
    assert.strictEqual(typeof client.getSorobanTransaction, "function");
  });

  await checkAsync("import() ESM SorobanModule", async () => {
    const mod = await import(`file://${ESM_SOROBAN}`);
    assert.strictEqual(typeof mod.SorobanModule, "function", "SorobanModule not exported from ESM");
  });

  await checkAsync("SorobanModule can be instantiated via import()", async () => {
    const { SorobanModule } = await import(`file://${ESM_SOROBAN}`);
    const soroban = new SorobanModule({ baseUrl: "http://localhost:3000" });
    assert.strictEqual(typeof soroban.getTransaction, "function");
  });
}

runEsmChecks().then(() => {
  console.log(`\n${"─".repeat(50)}`);
  if (failed === 0) {
    console.log(`✅  All ${passed} checks passed.\n`);
    process.exit(0);
  } else {
    console.error(`❌  ${failed} check(s) failed out of ${passed + failed}.\n`);
    process.exit(1);
  }
});
