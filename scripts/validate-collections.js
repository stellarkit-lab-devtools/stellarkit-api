#!/usr/bin/env node

/**
 * Validates Postman collection and environment files
 * Checks:
 * - JSON is valid
 * - All requests use {{baseUrl}} variable
 * - Request names are unique
 * - No literal API keys appear in the collection
 */

const fs = require("fs");
const path = require("path");

const COLLECTIONS_DIR = path.join(__dirname, "../examples/collections");
const COLLECTION_FILE = path.join(COLLECTIONS_DIR, "stellarkit-api.postman_collection.json");
const TESTNET_ENV = path.join(COLLECTIONS_DIR, "testnet.postman_environment.json");
const MAINNET_ENV = path.join(COLLECTIONS_DIR, "mainnet.postman_environment.json");

// Pattern that looks like a literal API key (not a variable)
const API_KEY_PATTERN = /[a-zA-Z0-9]{32,}/;
const BASEURL_PATTERN = /\{\{baseUrl\}\}/;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

function readJSON(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ValidationError(`Invalid JSON in ${path.basename(filePath)}: ${err.message}`);
    }
    throw err;
  }
}

function extractRequests(item, requests = []) {
  if (item.request) {
    requests.push({
      name: item.name,
      url: item.request.url,
      body: item.request.body,
      header: item.request.header,
    });
  }

  if (item.item && Array.isArray(item.item)) {
    item.item.forEach((subItem) => extractRequests(subItem, requests));
  }

  return requests;
}

function validateCollection(collection) {
  console.log("✓ Collection JSON is valid");

  const allRequests = [];
  if (collection.item && Array.isArray(collection.item)) {
    collection.item.forEach((item) => extractRequests(item, allRequests));
  }

  console.log(`✓ Found ${allRequests.length} requests`);

  // Check that all requests use {{baseUrl}}
  const requestsWithoutBaseUrl = allRequests.filter((req) => {
    const urlStr = typeof req.url === "string" ? req.url : req.url.raw || "";
    return !BASEURL_PATTERN.test(urlStr);
  });

  if (requestsWithoutBaseUrl.length > 0) {
    throw new ValidationError(
      `${requestsWithoutBaseUrl.length} request(s) do not use {{baseUrl}} variable:\n` +
        requestsWithoutBaseUrl.map((r) => `  - ${r.name}`).join("\n")
    );
  }

  console.log("✓ All requests use {{baseUrl}} variable");

  // Check for unique request names
  const nameCount = new Map();
  allRequests.forEach((req) => {
    nameCount.set(req.name, (nameCount.get(req.name) || 0) + 1);
  });

  const duplicateNames = Array.from(nameCount.entries())
    .filter(([, count]) => count > 1)
    .map(([name]) => name);

  if (duplicateNames.length > 0) {
    throw new ValidationError(
      `Duplicate request names found:\n` +
        duplicateNames.map((name) => `  - ${name} (${nameCount.get(name)}x)`).join("\n")
    );
  }

  console.log("✓ All request names are unique");

  // Check for literal API keys (not variables)
  const jsonStr = JSON.stringify(collection);
  const suspiciousKeys = [];

  // Look for API key headers with literal values
  allRequests.forEach((req) => {
    if (req.header && Array.isArray(req.header)) {
      req.header.forEach((header) => {
        if (
          header.key &&
          header.key.toLowerCase().includes("api") &&
          header.value &&
          !header.value.includes("{{") &&
          API_KEY_PATTERN.test(header.value)
        ) {
          suspiciousKeys.push(`${req.name}: ${header.key} = ${header.value}`);
        }
      });
    }

    // Check body for suspicious patterns
    if (req.body && req.body.raw) {
      try {
        const bodyObj = JSON.parse(req.body.raw);
        const bodyStr = JSON.stringify(bodyObj);
        if (bodyStr.includes("apiKey") && !bodyStr.includes("{{")) {
          const matches = bodyStr.match(/"apiKey"\s*:\s*"([^"]+)"/);
          if (matches && matches[1] && API_KEY_PATTERN.test(matches[1])) {
            suspiciousKeys.push(`${req.name}: body contains literal apiKey`);
          }
        }
      } catch (e) {
        // Ignore parse errors for body validation
      }
    }
  });

  if (suspiciousKeys.length > 0) {
    throw new ValidationError(
      `Possible literal API keys found:\n` +
        suspiciousKeys.map((key) => `  - ${key}`).join("\n")
    );
  }

  console.log("✓ No literal API keys detected");

  return allRequests.length;
}

function validateEnvironment(envData, envName) {
  console.log(`\n[${envName}]`);
  console.log("✓ Environment JSON is valid");

  if (!envData.values || !Array.isArray(envData.values)) {
    throw new ValidationError(`${envName}: Missing or invalid 'values' array`);
  }

  const requiredVars = ["baseUrl", "account", "assetCode", "assetIssuer"];
  const definedVars = new Set(envData.values.map((v) => v.key));

  const missingVars = requiredVars.filter((v) => !definedVars.has(v));
  if (missingVars.length > 0) {
    throw new ValidationError(
      `${envName}: Missing required variables: ${missingVars.join(", ")}`
    );
  }

  console.log(`✓ All required variables defined: ${requiredVars.join(", ")}`);

  // Check that baseUrl is set
  const baseUrlVar = envData.values.find((v) => v.key === "baseUrl");
  if (!baseUrlVar || !baseUrlVar.value) {
    throw new ValidationError(`${envName}: baseUrl variable has no value`);
  }

  console.log(`✓ baseUrl is set to: ${baseUrlVar.value}`);
}

function main() {
  console.log("Validating Postman collections and environments...\n");

  try {
    // Validate collection
    console.log("[Collection]");
    const collection = readJSON(COLLECTION_FILE);
    const requestCount = validateCollection(collection);

    // Validate environments
    const testnetEnv = readJSON(TESTNET_ENV);
    validateEnvironment(testnetEnv, "Testnet Environment");

    const mainnetEnv = readJSON(MAINNET_ENV);
    validateEnvironment(mainnetEnv, "Mainnet Environment");

    console.log("\n✅ All validations passed!");
    console.log(`   Total requests in collection: ${requestCount}`);
    process.exit(0);
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error(`\n❌ Validation failed:\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateCollection, validateEnvironment };
