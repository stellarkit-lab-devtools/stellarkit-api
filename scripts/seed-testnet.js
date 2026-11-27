/**
 * seed-testnet.js
 *
 * Creates a rerunnable demo world on Stellar testnet:
 *   - A funded issuer account
 *   - A DEMO asset with trustlines on two holder accounts
 *   - Payments and open offers
 *   - A claimable balance, a data entry, and a multisig account
 *
 * Keys persist to .seed/ so reruns reuse them.
 *
 * Usage:
 *   npm run seed:testnet
 *   npm run seed:testnet -- --print-secrets
 *
 * Refuses to run when STELLAR_NETWORK=mainnet.
 */

"use strict";

const StellarSdk = require("@stellar/stellar-sdk");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ── Mainnet guard ────────────────────────────────────────────────────────────

/**
 * Returns true when the environment looks like mainnet.
 * Exported for unit testing without network access.
 */
function isMainnet() {
  return (process.env.STELLAR_NETWORK || "").toLowerCase() === "mainnet";
}

function assertNotMainnet() {
  if (isMainnet()) {
    console.error(
      "❌  Refusing to run: STELLAR_NETWORK=mainnet. This script only works on testnet.",
    );
    process.exit(1);
  }
}

// ── Key persistence (.seed/ directory) ────────────────────────────��─────────

const SEED_DIR = path.resolve(__dirname, "../.seed");

function ensureSeedDir() {
  if (!fs.existsSync(SEED_DIR)) {
    fs.mkdirSync(SEED_DIR, { recursive: true });
  }
}

function keyFile(name) {
  return path.join(SEED_DIR, `${name}.json`);
}

function loadOrCreate(name) {
  const file = keyFile(name);
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return StellarSdk.Keypair.fromSecret(data.secret);
  }
  const kp = StellarSdk.Keypair.random();
  fs.writeFileSync(file, JSON.stringify({ public: kp.publicKey(), secret: kp.secret() }, null, 2));
  return kp;
}

// ── Plan builder ─────────────────────────────────────────────────────────────

/**
 * Builds the demo plan — a plain object describing what accounts and assets
 * will be created. Pure function; no network access; testable in isolation.
 *
 * @param {{ issuer: string, holderA: string, holderB: string, multisig: string }} keys
 * @returns {{ accounts: string[], assetCode: string, assetIssuer: string }}
 */
function buildPlan(keys) {
  return {
    accounts: [keys.issuer, keys.holderA, keys.holderB, keys.multisig],
    assetCode: "DEMO",
    assetIssuer: keys.issuer,
  };
}

// ── Friendbot ────────────────────────────────────────────────────────────────

async function friendbot(publicKey) {
  const url = `https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`;
  try {
    await axios.get(url, {
      headers: { Accept: "application/json" },
      timeout: 30_000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
  } catch (err) {
    const msg = err?.response?.data || err?.message || String(err);
    throw new Error(
      `Friendbot failed for ${publicKey}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`,
    );
  }
}

// ── Horizon helpers ───────────────────────────────────────────────────────────

const server = new StellarSdk.Horizon.Server("https://horizon-testnet.stellar.org");
const networkPassphrase = StellarSdk.Networks.TESTNET;

async function loadAccount(publicKey) {
  return server.loadAccount(publicKey);
}

async function submitTx(tx) {
  return server.submitTransaction(tx);
}

function buildTx(sourceAccount, operations, opts = {}) {
  const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  });
  for (const op of operations) {
    builder.addOperation(op);
  }
  return builder.setTimeout(opts.timeout || 30).build();
}

// ── Setup steps ───────────────────────────────────────────────────────────────

async function fundAll(keypairs) {
  console.log("\n📡  Funding accounts via Friendbot…");
  for (const kp of keypairs) {
    process.stdout.write(`  → ${kp.publicKey()} … `);
    try {
      await friendbot(kp.publicKey());
      console.log("funded");
    } catch (err) {
      // Already funded (409) is acceptable on reruns
      if (err.message && err.message.includes("createAccountAlreadyExist")) {
        console.log("already exists");
      } else {
        console.log("skipped (may already be funded)");
      }
    }
  }
}

async function setupTrustlines(holderAKp, holderBKp, demoAsset) {
  console.log("\n🔗  Establishing DEMO trustlines…");

  for (const [label, kp] of [["holderA", holderAKp], ["holderB", holderBKp]]) {
    const account = await loadAccount(kp.publicKey());
    const tx = buildTx(account, [
      StellarSdk.Operation.changeTrust({ asset: demoAsset }),
    ]);
    tx.sign(kp);
    await submitTx(tx);
    console.log(`  ✓ ${label} trustline established`);
  }
}

async function sendPayments(issuerKp, holderAKp, holderBKp, demoAsset) {
  console.log("\n💸  Sending DEMO payments…");
  const issuerAccount = await loadAccount(issuerKp.publicKey());
  const tx = buildTx(issuerAccount, [
    StellarSdk.Operation.payment({
      destination: holderAKp.publicKey(),
      asset: demoAsset,
      amount: "1000",
    }),
    StellarSdk.Operation.payment({
      destination: holderBKp.publicKey(),
      asset: demoAsset,
      amount: "500",
    }),
  ]);
  tx.sign(issuerKp);
  await submitTx(tx);
  console.log("  ✓ 1000 DEMO → holderA, 500 DEMO → holderB");
}

async function placeOffer(holderAKp, demoAsset) {
  console.log("\n📋  Placing open offer…");
  const account = await loadAccount(holderAKp.publicKey());
  const tx = buildTx(account, [
    StellarSdk.Operation.manageSellOffer({
      selling: demoAsset,
      buying: StellarSdk.Asset.native(),
      amount: "100",
      price: "0.5",
    }),
  ]);
  tx.sign(holderAKp);
  await submitTx(tx);
  console.log("  ✓ Sell offer placed: 100 DEMO @ 0.5 XLM");
}

async function createClaimableBalance(issuerKp, holderAKp, demoAsset) {
  console.log("\n🏦  Creating claimable balance…");
  const account = await loadAccount(issuerKp.publicKey());
  const tx = buildTx(account, [
    StellarSdk.Operation.createClaimableBalance({
      asset: demoAsset,
      amount: "50",
      claimants: [
        new StellarSdk.Claimant(holderAKp.publicKey()),
      ],
    }),
  ]);
  tx.sign(issuerKp);
  await submitTx(tx);
  console.log("  ✓ 50 DEMO claimable balance created for holderA");
}

async function addDataEntry(holderBKp) {
  console.log("\n📝  Adding data entry…");
  const account = await loadAccount(holderBKp.publicKey());
  const tx = buildTx(account, [
    StellarSdk.Operation.manageData({
      name: "demo_key",
      value: "stellarkit_seed",
    }),
  ]);
  tx.sign(holderBKp);
  await submitTx(tx);
  console.log("  ✓ Data entry 'demo_key' = 'stellarkit_seed' added to holderB");
}

async function setupMultisig(multisigKp, issuerKp) {
  console.log("\n🔐  Setting up multisig account…");
  const account = await loadAccount(multisigKp.publicKey());
  const tx = buildTx(account, [
    StellarSdk.Operation.setOptions({
      signer: { ed25519PublicKey: issuerKp.publicKey(), weight: 1 },
      lowThreshold: 1,
      medThreshold: 2,
      highThreshold: 2,
    }),
  ]);
  tx.sign(multisigKp);
  await submitTx(tx);
  console.log("  ✓ Multisig: issuer added as co-signer (weight 1), med/high threshold = 2");
}

// ── Output table ──────────────────────────────────────────────────────────────

function printTable(keypairs, printSecrets) {
  const API_BASE = `http://localhost:${process.env.PORT || 3000}`;

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║               StellarKit Testnet Seed Accounts               ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  for (const { label, kp } of keypairs) {
    console.log(`  ${label}`);
    console.log(`    Public key : ${kp.publicKey()}`);
    if (printSecrets) {
      console.log(`    Secret key : ${kp.secret()}`);
    }
    console.log();
  }

  const issuer = keypairs.find((k) => k.label === "issuer").kp.publicKey();
  const holderA = keypairs.find((k) => k.label === "holderA").kp.publicKey();

  console.log("  Ready-to-run curl examples:\n");
  console.log(`  # Account balances`);
  console.log(`  curl "${API_BASE}/account/${holderA}/balances"\n`);
  console.log(`  # Asset metadata`);
  console.log(`  curl "${API_BASE}/asset/DEMO/${issuer}"\n`);
  console.log(`  # Asset holders`);
  console.log(`  curl "${API_BASE}/asset/DEMO/${issuer}/holders"\n`);
  console.log(`  # Open offers`);
  console.log(`  curl "${API_BASE}/account/${holderA}/offers"\n`);
  console.log(`  # Claimable balances for holderA`);
  console.log(`  curl "${API_BASE}/claimable-balances?claimant=${holderA}"\n`);
  console.log(`  # Signing keys (multisig)`);
  const multisig = keypairs.find((k) => k.label === "multisig").kp.publicKey();
  console.log(`  curl "${API_BASE}/account/${multisig}/signing-keys"\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  assertNotMainnet();

  const printSecrets = process.argv.includes("--print-secrets");

  ensureSeedDir();

  const issuerKp = loadOrCreate("issuer");
  const holderAKp = loadOrCreate("holderA");
  const holderBKp = loadOrCreate("holderB");
  const multisigKp = loadOrCreate("multisig");

  const keypairs = [
    { label: "issuer", kp: issuerKp },
    { label: "holderA", kp: holderAKp },
    { label: "holderB", kp: holderBKp },
    { label: "multisig", kp: multisigKp },
  ];

  const demoAsset = new StellarSdk.Asset("DEMO", issuerKp.publicKey());

  // Build and log the plan
  const plan = buildPlan({
    issuer: issuerKp.publicKey(),
    holderA: holderAKp.publicKey(),
    holderB: holderBKp.publicKey(),
    multisig: multisigKp.publicKey(),
  });
  console.log(`\n🌐  Network : testnet`);
  console.log(`📦  Asset   : ${plan.assetCode} issued by ${plan.assetIssuer.slice(0, 10)}…`);

  await fundAll([issuerKp, holderAKp, holderBKp, multisigKp]);
  await setupTrustlines(holderAKp, holderBKp, demoAsset);
  await sendPayments(issuerKp, holderAKp, holderBKp, demoAsset);
  await placeOffer(holderAKp, demoAsset);
  await createClaimableBalance(issuerKp, holderAKp, demoAsset);
  await addDataEntry(holderBKp);
  await setupMultisig(multisigKp, issuerKp);

  printTable(keypairs, printSecrets);

  console.log("\n✅  Seed complete. Keys saved to .seed/");
  if (!printSecrets) {
    console.log("   Tip: run with --print-secrets to also display secret keys.\n");
  }
}

main().catch((err) => {
  console.error("\n❌  Seed failed:", err?.message || err);
  process.exit(1);
});

module.exports = { isMainnet, buildPlan };
