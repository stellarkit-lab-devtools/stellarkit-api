const axios = require("axios");

function removeInlineComments(line) {
  let inQuote = false;
  let quoteChar = null;
  let escaped = false;
  let result = "";

  for (const char of line) {
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      result += char;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuote && char === quoteChar) {
        inQuote = false;
        quoteChar = null;
      } else if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      }
      result += char;
      continue;
    }

    if (char === "#" && !inQuote) {
      break;
    }

    result += char;
  }

  return result.trim();
}

function parseTomlValue(rawValue) {
  const value = rawValue.trim();

  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;

  if ((value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];

    const items = [];
    let current = "";
    let inQuote = false;
    let quoteChar = null;
    let escaped = false;

    for (const char of inner) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        current += char;
        continue;
      }

      if ((char === '"' || char === "'") && !inQuote) {
        inQuote = true;
        quoteChar = char;
        current += char;
        continue;
      }

      if (char === quoteChar && inQuote) {
        inQuote = false;
        quoteChar = null;
        current += char;
        continue;
      }

      if (char === "," && !inQuote) {
        items.push(parseTomlValue(current));
        current = "";
        continue;
      }

      current += char;
    }

    if (current !== "") {
      items.push(parseTomlValue(current));
    }

    return items;
  }

  const numberValue = Number(value);
  if (!Number.isNaN(numberValue) && value !== "") {
    return numberValue;
  }

  return value;
}

function parseStellarToml(content) {
  const toml = {};
  let currentSection = null;
  let currentSectionMode = null;

  const lines = String(content).split(/\r?\n/);
  for (const rawLine of lines) {
    const line = removeInlineComments(rawLine).trim();
    if (!line) continue;

    const arrayTableMatch = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayTableMatch) {
      const sectionName = arrayTableMatch[1].trim();
      if (!toml[sectionName]) {
        toml[sectionName] = [];
      }
      const newSection = {};
      toml[sectionName].push(newSection);
      currentSection = newSection;
      currentSectionMode = "array";
      continue;
    }

    const tableMatch = line.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      const sectionName = tableMatch[1].trim();
      if (!toml[sectionName] || typeof toml[sectionName] !== "object" || Array.isArray(toml[sectionName])) {
        toml[sectionName] = {};
      }
      currentSection = toml[sectionName];
      currentSectionMode = "table";
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;

    const [, rawKey, rawValue] = kvMatch;
    const key = rawKey.trim();
    const value = parseTomlValue(rawValue.trim());

    if (currentSection) {
      currentSection[key] = value;
    } else {
      toml[key] = value;
    }
  }

  return toml;
}

/**
 * Fetches and parses a Stellar TOML file from a given home domain.
 *
 * @param {string} homeDomain - The home domain to fetch TOML from (e.g., "stellar.org")
 * @param {number} [timeout=5000] - Request timeout in milliseconds
 * @returns {Promise<Object|null>} Parsed TOML object or null if not found/unreachable
 */
async function fetchStellarToml(homeDomain, timeout = 5000) {
  if (!homeDomain) return null;

  try {
    const tomlUrl = `https://${homeDomain}/.well-known/stellar.toml`;
    const response = await axios.get(tomlUrl, {
      timeout,
      headers: {
        "User-Agent": "StellarKit-API/1.0",
      },
    });

    return parseStellarToml(response.data);
  } catch (error) {
    return null;
  }
}

/**
 * Gets asset metadata from TOML for a specific asset code.
 *
 * @param {string} homeDomain - The issuer's home domain
 * @param {string} assetCode - The asset code to find in TOML
 * @returns {Promise<Object|null>} Asset metadata with name, description, image, or null
 */
async function getAssetMetadataFromToml(homeDomain, assetCode) {
  if (!homeDomain || !assetCode) return null;

  try {
    const toml = await fetchStellarToml(homeDomain);
    if (!toml || !toml.CURRENCIES) return null;

    const currencyEntries = toml.CURRENCIES;
    if (!Array.isArray(currencyEntries)) return null;

    for (const entry of currencyEntries) {
      if (entry.code === assetCode) {
        return {
          name: entry.name || null,
          description: entry.desc || null,
          image: entry.image || null,
        };
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

module.exports = {
  fetchStellarToml,
  getAssetMetadataFromToml,
};
