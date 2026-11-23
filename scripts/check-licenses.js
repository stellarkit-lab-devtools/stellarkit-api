/**
 * npm run licenses
 *
 * Lists production dependency licences and exits non-zero for any not on
 * the allowlist in config/license-allowlist.json.
 *
 * SPDX expressions are evaluated correctly: "A OR B" passes if either side is
 * allowed, and "A AND B" needs both.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { evaluateSpdxExpression, ALLOWED_LICENSES } = require("../src/utils/spdx");

/**
 * Get production dependencies from npm as JSON.
 * Uses `npm ls --production --json` which excludes devDependencies.
 *
 * @returns {object} npm dependency tree
 */
function getProductionDeps() {
  const output = execSync("npm ls --production --json --depth=Infinity", {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(output);
}

/**
 * Flatten the npm dependency tree into a list of { name, version } entries.
 *
 * @param {object} tree - npm ls output
 * @returns {Array<{name: string, version: string}>}
 */
function flattenDeps(tree) {
  const result = [];
  const seen = new Set();

  function walk(deps) {
    if (!deps) return;
    for (const [name, info] of Object.entries(deps)) {
      const key = `${name}@${info.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ name, version: info.version });
      if (info.dependencies) walk(info.dependencies);
    }
  }

  walk(tree.dependencies);
  return result;
}

/**
 * Read the license for a package from its node_modules directory.
 *
 * @param {string} name - Package name (may be scoped)
 * @param {string} version - Package version
 * @returns {string|null} SPDX license identifier or expression
 */
function getPackageLicense(name, version) {
  try {
    const pkgPath = path.join(__dirname, "..", "node_modules", name, "package.json");
    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const license = pkgJson.license || (Array.isArray(pkgJson.licenses) ? pkgJson.licenses.map(l => l.type || l.name).filter(Boolean).join(" OR ") : null);
    return license || "UNKNOWN";
  } catch (_) {
    return "UNKNOWN";
  }
}

/**
 * Load the allowlist from config/license-allowlist.json.
 * Falls back to the default ALLOWED_LICENSES set if the file doesn't exist.
 *
 * @returns {{ allowed: Set<string>, exceptions: object }}
 */
function loadAllowlist() {
  const configPath = path.join(__dirname, "..", "config", "license-allowlist.json");
  let config = { allowed: [...ALLOWED_LICENSES], exceptions: {} };

  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (Array.isArray(raw.allowed)) {
        config.allowed = raw.allowed;
      }
      if (raw.exceptions && typeof raw.exceptions === "object") {
        config.exceptions = raw.exceptions;
      }
    } catch (_) {
      // Use defaults if config is malformed
    }
  }

  return { allowed: new Set(config.allowed), exceptions: config.exceptions };
}

function main() {
  const rootDir = path.join(__dirname, "..");
  const { allowed, exceptions } = loadAllowlist();

  console.log("Scanning production dependencies...\n");

  const tree = getProductionDeps();
  const deps = flattenDeps(tree);

  const violations = [];
  const allowed_list = [];

  for (const dep of deps) {
    const license = getPackageLicense(dep.name, dep.version);
    const isAllowed = evaluateSpdxExpression(license, allowed);

    if (isAllowed) {
      allowed_list.push({ name: dep.name, version: dep.version, license });
    } else {
      // Check if there's a written justification for this package
      const exceptionKey = dep.name;
      const hasException = exceptions[exceptionKey] && typeof exceptions[exceptionKey] === "string" && exceptions[exceptionKey].trim().length > 0;

      if (hasException) {
        allowed_list.push({ name: dep.name, version: dep.version, license, justification: exceptions[exceptionKey] });
      } else {
        violations.push({ name: dep.name, version: dep.version, license });
      }
    }
  }

  // Print allowed packages
  console.log("Allowed licenses:");
  for (const dep of allowed_list) {
    const note = dep.justification ? ` (justified: ${dep.justification})` : "";
    console.log(`  ${dep.name}@${dep.version} — ${dep.license}${note}`);
  }

  // Print violations
  if (violations.length > 0) {
    console.log("\nVIOLATIONS — packages with disallowed licences:\n");
    for (const v of violations) {
      console.log(`  ${v.name}@${v.version} — ${v.license}`);
      console.log(`    Add a written justification to config/license-allowlist.json under "exceptions" if this is intentional.\n`);
    }
    console.log(`${violations.length} violation(s) found.`);
    process.exit(1);
  } else {
    console.log(`\nAll ${allowed_list.length} production dependencies are allowed.`);
  }
}

main();
