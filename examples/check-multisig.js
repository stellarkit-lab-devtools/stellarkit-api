/**
 * check-multisig.js
 *
 * A runnable script that checks the multisig configuration of a Stellar account
 * by calling the StellarKit API endpoint GET /account/:id/multisig-info.
 *
 * It prints a human-readable summary that includes:
 *   - Whether the account is multisig-enabled
 *   - The master key weight
 *   - The three threshold levels (low, medium, high) and what each protects
 *   - Every registered signer with their key, weight, and type
 *
 * Usage:
 *   node examples/check-multisig.js <STELLAR_ADDRESS>
 *
 * Example:
 *   node examples/check-multisig.js GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7
 *
 * The script targets Testnet by default. Set the API_URL environment variable
 * to point at a different StellarKit instance (e.g. a Mainnet deployment):
 *   API_URL=https://my-stellarkit.example.com node examples/check-multisig.js G...
 */

const https = require("https");
const http = require("http");

// ── Configuration ─────────────────────────────────────────────────────────────

// Base URL of the running StellarKit API instance.
// Defaults to localhost:3000 (the dev server) when API_URL is not set.
const API_BASE_URL = process.env.API_URL || "http://localhost:3000";

// ── Helper: simple HTTP(S) GET ────────────────────────────────────────────────

/**
 * Performs a GET request and returns the parsed JSON body.
 *
 * Using Node's built-in http/https instead of a third-party library keeps the
 * script dependency-free — it will run with `node examples/check-multisig.js`
 * without any `npm install` step.
 *
 * @param {string} url - Fully-qualified URL to fetch.
 * @returns {Promise<object>} Parsed JSON response body.
 */
function getJSON(url) {
  return new Promise((resolve, reject) => {
    // Choose the right transport based on the protocol prefix
    const transport = url.startsWith("https") ? https : http;

    transport
      .get(url, (res) => {
        let raw = "";

        // Accumulate response chunks as they arrive
        res.on("data", (chunk) => {
          raw += chunk;
        });

        // Once the full response body is in, parse and resolve
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(`Failed to parse JSON response: ${e.message}`));
          }
        });
      })
      .on("error", (err) => {
        // Network-level errors (connection refused, DNS failure, etc.)
        reject(err);
      });
  });
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Returns a visually distinct divider line. */
function divider(char = "─", width = 70) {
  return char.repeat(width);
}

/**
 * Maps a Stellar signer type string to a short, readable label.
 *
 * Stellar supports three signer key types:
 *   ed25519_public_key — the standard G... account key
 *   hash_x             — SHA-256 hash pre-image (used for atomic swaps)
 *   pre_auth_tx        — pre-authorized transaction hash
 */
function friendlySignerType(type) {
  const labels = {
    ed25519_public_key: "Ed25519 public key  (standard G... address)",
    hash_x:             "Hash(x)             (SHA-256 pre-image signer)",
    pre_auth_tx:        "Pre-auth TX         (pre-authorized transaction)",
  };
  return labels[type] || type;
}

/**
 * Describes the threshold level in plain language so developers understand
 * which operations each level controls.
 *
 * Stellar threshold semantics:
 *   Low  — required for allow-trust, bump-sequence, claim-claimable-balance
 *   Med  — required for most operations: payments, offers, trustlines, …
 *   High — required for account-modifying operations: set-options, account-merge
 */
function thresholdLabel(level) {
  const labels = {
    low:  "Low   (allow-trust, bump-sequence)",
    medium: "Med   (payments, offers, trustlines, ...)",
    high: "High  (set-options, account-merge)",
  };
  return labels[level] || level;
}

// ── Main logic ────────────────────────────────────────────────────────────────

/**
 * Fetches and prints the multisig summary for the given Stellar address.
 *
 * @param {string} address - A Stellar public key (G... format).
 */
async function checkMultisig(address) {
  // Step 1: Build the endpoint URL.
  // GET /account/:id/multisig-info returns isMultisig, thresholds, signers, etc.
  const url = `${API_BASE_URL}/account/${address}/multisig-info`;

  console.log(`\n${divider("═")}`);
  console.log(`  StellarKit — Multisig Configuration Check`);
  console.log(`${divider("═")}`);
  console.log(`  Account : ${address}`);
  console.log(`  API     : ${API_BASE_URL}`);
  console.log(`${divider()}\n`);

  // Step 2: Call the API endpoint.
  let body;
  try {
    body = await getJSON(url);
  } catch (err) {
    // Handle network-level failures (API not running, wrong host, etc.)
    console.error(`❌  Network error: ${err.message}`);
    console.error(`    Make sure the StellarKit API is running at: ${API_BASE_URL}`);
    console.error(`    Start it with: npm run dev\n`);
    process.exit(1);
  }

  // Step 3: Handle API-level errors (bad address, account not found, etc.)
  if (!body.success) {
    const error = body.error || {};
    console.error(`❌  API error (${error.type || "Unknown"}): ${error.message || "No message"}`);
    if (error.suggestion) {
      console.error(`    Suggestion: ${error.suggestion}`);
    }
    console.log();
    process.exit(1);
  }

  // Step 4: Destructure the response payload.
  const {
    accountId,
    isMultisig,
    masterWeight,
    thresholds,
    signers,
    signerCount,
  } = body.data;

  // Step 5: Print the high-level multisig status.
  const statusIcon = isMultisig ? "🔐" : "🔓";
  const statusText = isMultisig
    ? "MULTISIG  — multiple signatures may be required"
    : "SINGLE-SIG — the master key is the sole signer";

  console.log(`  ${statusIcon}  Status : ${statusText}`);
  console.log(`  Account ID : ${accountId}`);
  console.log(`  Signers registered : ${signerCount}`);
  console.log();

  // Step 6: Print the threshold table.
  // Thresholds control how many combined signature weights are needed for
  // each category of operation.
  console.log(`${divider()}`);
  console.log(`  Signature Thresholds`);
  console.log(`${divider()}`);

  for (const level of ["low", "medium", "high"]) {
    const value = thresholds[level];
    // Indicate when the master key alone can meet the threshold
    const met = value <= masterWeight ? " ← master key alone is sufficient" : "";
    console.log(`  ${thresholdLabel(level).padEnd(44)} weight needed: ${value}${met}`);
  }

  console.log(`\n  Master key weight : ${masterWeight}`);
  console.log();

  // Step 7: Print each signer's details.
  // This is the most useful part for developers debugging signing issues —
  // they can see exactly which keys are registered and how much weight each carries.
  console.log(`${divider()}`);
  console.log(`  Registered Signers  (${signerCount} total)`);
  console.log(`${divider()}`);

  signers.forEach((signer, index) => {
    const isMaster = signer.key === accountId;
    const masterTag = isMaster ? "  [master key]" : "";

    console.log(`\n  Signer ${index + 1}${masterTag}`);
    console.log(`    Key    : ${signer.key}`);
    console.log(`    Weight : ${signer.weight}`);
    console.log(`    Type   : ${friendlySignerType(signer.type)}`);
  });

  console.log(`\n${divider()}`);

  // Step 8: Print a plain-English interpretation so it is immediately clear
  // whether the setup is correct for common multisig patterns.
  console.log(`\n  Summary`);
  console.log(`${divider()}`);

  if (!isMultisig) {
    console.log(`  This account has a standard single-signer setup.`);
    console.log(`  The master key can authorise all operations independently.`);
  } else {
    const totalWeight = signers.reduce((sum, s) => sum + s.weight, 0);
    console.log(`  Combined signer weight : ${totalWeight}`);

    // Flag any threshold that cannot be met even with all signers combined
    const unreachable = [];
    if (totalWeight < thresholds.low)  unreachable.push("low");
    if (totalWeight < thresholds.medium) unreachable.push("medium");
    if (totalWeight < thresholds.high) unreachable.push("high");

    if (unreachable.length > 0) {
      console.log(`\n  ⚠️  WARNING: The following thresholds CANNOT be met with`);
      console.log(`     the currently registered signers:`);
      unreachable.forEach((t) => {
        console.log(`       - ${t} threshold (requires ${thresholds[t]}, available ${totalWeight})`);
      });
    } else {
      console.log(`  All thresholds can be met by the registered signers.`);
    }
  }

  console.log(`\n${divider("═")}\n`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

// Read the Stellar address from the first command-line argument
const address = process.argv[2];

if (!address) {
  console.error("❌  Error: Please provide a Stellar account address.\n");
  console.log("Usage:");
  console.log("  node examples/check-multisig.js <STELLAR_ADDRESS>\n");
  console.log("Example:");
  console.log(
    "  node examples/check-multisig.js GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7\n",
  );
  process.exit(1);
}

// Run the main function and catch any unhandled promise rejections
checkMultisig(address).catch((err) => {
  console.error(`\n❌  Unexpected error: ${err.message}\n`);
  process.exit(1);
});
