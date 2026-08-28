const axios = require("axios");
const cacheService = require("../services/cache");
const cacheTTL = require("../config/cacheConfig");

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
 * Normalises a raw TOML object (as returned by parseStellarToml) into the
 * StellarKit camelCase convention:
 *
 *  - All top-level and nested keys are converted to camelCase
 *  - Optional top-level sections (documentation, currencies, validators,
 *    accounts, principals) are always present — set to null when absent
 *  - Each currency entry gains a normalised `asset` field: { code, issuer, type }
 *  - Raw anchor_asset_type / anchor_asset fields are removed from currency entries
 *
 * @param {Object} raw - The raw parsed TOML object
 * @returns {Object} The normalised TOML object
 */
function normaliseStellarToml(raw) {
  if (!raw || typeof raw !== "object") return raw;

  // Helper: snake_case / ALL_CAPS key → camelCase
  function toCamel(key) {
    return key
      .toLowerCase()
      .replace(/[_-]([a-z0-9])/g, (_, c) => c.toUpperCase());
  }

  // Recursively convert all keys in any plain object / array
  function deepCamel(value) {
    if (Array.isArray(value)) return value.map(deepCamel);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [toCamel(k), deepCamel(v)]),
      );
    }
    return value;
  }

  // Camel-case all raw keys first
  const base = deepCamel(raw);

  // Determine the asset type string from anchor_asset_type / anchorAssetType
  function resolveAssetType(entry) {
    const raw_type =
      entry.anchorAssetType || entry.anchor_asset_type || null;
    if (!raw_type) return "credit_alphanum4";
    const t = String(raw_type).toLowerCase();
    if (t === "native") return "native";
    if (t === "credit_alphanum12") return "credit_alphanum12";
    return "credit_alphanum4";
  }

  // Normalise a single currency entry
  function normaliseCurrency(entry) {
    const { anchorAssetType, anchorAsset, ...rest } = entry;

    const code = rest.code || null;
    const issuer = rest.issuer || null;
    const assetType = resolveAssetType(entry);

    return {
      ...rest,
      // Always include the standard asset shape; never expose anchor_asset_type
      asset: { code, issuer, type: assetType },
    };
  }

  // Build the normalised currencies array (null when absent)
  const rawCurrencies = base.currencies || raw.CURRENCIES || null;
  const currencies = Array.isArray(rawCurrencies)
    ? rawCurrencies.map(normaliseCurrency)
    : null;

  // Ensure all well-known optional sections are always present (null if absent)
  const documentation = base.documentation || raw.DOCUMENTATION || null;
  const validators = base.validators || raw.VALIDATORS || null;
  const accounts = base.accounts || raw.ACCOUNTS || null;
  const principals = base.principals || raw.PRINCIPALS || null;

  // Strip the raw uppercase section keys — they've been normalised above
  const {
    documentation: _doc,
    currencies: _cur,
    validators: _val,
    accounts: _acc,
    principals: _pri,
    // Also drop any SCREAMING_SNAKE leftovers (shouldn't exist after deepCamel,
    // but guard just in case parseStellarToml produces non-standard keys)
    ...rest
  } = base;

  return {
    ...rest,
    documentation: documentation ? deepCamel(documentation) : null,
    currencies,
    validators: validators ? validators.map(deepCamel) : null,
    accounts: accounts ? accounts.map(deepCamel) : null,
    principals: principals ? principals.map(deepCamel) : null,
  };
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

/**
 * Fetches, caches, and returns the normalised stellar.toml for a domain.
 *
 * Cache key: `stellar-toml:<domain>`
 * TTL: CACHE_TTL_TOML_MS env var (default 300 000 ms / 5 minutes)
 *
 * @param {string} domain - The home domain (e.g. "stellar.org")
 * @param {boolean} [fresh=false] - When true, bypass cache and re-fetch
 * @returns {Promise<{ toml: Object|null, cacheHit: boolean }>}
 */
async function fetchNormalisedToml(domain, fresh = false) {
  const cacheKey = `stellar-toml:${domain}`;

  if (!fresh) {
    const cached = cacheService.get(cacheKey);
    if (cached !== undefined) {
      return { toml: cached, cacheHit: true };
    }
  }

  const raw = await fetchStellarToml(domain);
  if (!raw) return { toml: null, cacheHit: false };

  const normalised = normaliseStellarToml(raw);
  cacheService.set(cacheKey, normalised, cacheTTL.toml);
  return { toml: normalised, cacheHit: false };
}

module.exports = {
  fetchStellarToml,
  normaliseStellarToml,
  fetchNormalisedToml,
  getAssetMetadataFromToml,
};
