/**
 * npm run sbom
 *
 * Writes a CycloneDX JSON SBOM to the reports/ directory.
 *
 * The SBOM lists all production dependencies with their names, versions,
 * and licence identifiers.  The output is CycloneDX 1.5 format.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

/**
 * Get production dependencies from npm as JSON.
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
 * @param {string} name - Package name
 * @param {string} version - Package version
 * @returns {string} SPDX license identifier or "UNKNOWN"
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

function main() {
  const rootDir = path.join(__dirname, "..");
  const reportsDir = path.join(rootDir, "reports");

  // Ensure reports/ directory exists
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"));

  const tree = getProductionDeps();
  const deps = flattenDeps(tree);

  // Build CycloneDX components
  const components = deps.map((dep) => {
    const license = getPackageLicense(dep.name, dep.version);
    const bomRef = `pkg:npm/${dep.name}@${dep.version}`;
    return {
      type: "library",
      "bom-ref": bomRef,
      name: dep.name,
      version: dep.version,
      purl: bomRef,
      licenses: license !== "UNKNOWN" ? [{ license: { id: license } }] : [],
    };
  });

  // Compute serial number
  const timestamp = new Date().toISOString();
  const serial = crypto.createHash("sha256").update(timestamp + JSON.stringify(components)).digest("hex").slice(0, 36);

  const sbom = {
    "$schema": "http://cyclonedx.org/schema/bom-1.5.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${serial}`,
    version: 1,
    metadata: {
      timestamp,
      tools: {
        components: [
          {
            type: "application",
            name: "stellarkit-api-sbom",
            version: pkgJson.version || "1.0.0",
          },
        ],
      },
      component: {
        type: "application",
        name: pkgJson.name,
        version: pkgJson.version,
      },
    },
    components,
  };

  const outputPath = path.join(reportsDir, "sbom.cyclonedx.json");
  fs.writeFileSync(outputPath, JSON.stringify(sbom, null, 2));

  console.log(`SBOM written to ${path.relative(rootDir, outputPath)} (${components.length} components)`);
}

main();
