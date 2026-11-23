// API Key Authentication Middleware
// Optional mode: activated via REQUIRE_API_KEY=true env var
// Clients send key via X-API-Key header
// Keys configurable via API_KEYS env var (comma-separated), optionally with a
// ":read" / ":admin" scope suffix. Unsuffixed keys are legacy read-only keys.
// Returns 401 for missing/invalid key when enabled, 403 when a key lacks the
// scope required by an operational endpoint.
// /health and / endpoints are always public

const crypto = require('crypto');
const logger = require('../utils/logger');

const VALID_SCOPES = new Set(['read', 'admin']);
const ADMIN_PATH_PREFIXES = ['/metrics', '/cache/stats'];

// Load and hash all API keys on startup (module load)
let hashedKeys = [];

/**
 * Parse a single API_KEYS entry into its key and scope.
 * Entries with an unknown scope are rejected (and logged) so a typo cannot
 * silently grant unintended access.
 */
function parseKeyEntry(entry) {
  const separator = entry.lastIndexOf(':');
  const key = separator === -1 ? entry : entry.slice(0, separator);
  const scope = separator === -1 ? 'read' : entry.slice(separator + 1);

  if (!VALID_SCOPES.has(scope)) {
    logger.error(
      { scope },
      `Rejected API key entry with unknown scope '${scope}'. Valid scopes: read, admin.`
    );
    return null;
  }
  if (!key) {
    logger.error('Rejected empty API key entry.');
    return null;
  }
  return { key, scope };
}

const rawKeys = process.env.API_KEYS;
if (rawKeys) {
  const keysArray = rawKeys.split(',').map(key => key.trim()).filter(Boolean);
  hashedKeys = keysArray
    .map(parseKeyEntry)
    .filter(Boolean)
    .map(({ key, scope }) => ({
      hash: crypto.createHash('sha256').update(key).digest('hex'),
      scope,
    }));

  // Clear plaintext keys from memory to prevent extraction if compromised
  for (let i = 0; i < keysArray.length; i++) {
    keysArray[i] = '';
  }
  delete process.env.API_KEYS;
}

function isAdminPath(req) {
  const path = (req.originalUrl || req.path || '').split('?')[0];
  return ADMIN_PATH_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(prefix));
}

const apiKeyMiddleware = (req, res, next) => {
  const requireApiKey = process.env.REQUIRE_API_KEY === 'true';

  // Scopes (and authentication entirely) are not enforced when disabled.
  if (!requireApiKey) {
    return next();
  }

  const requestPath = (req.originalUrl || req.path || '').split('?')[0];

  // Allow public access to health check and root endpoint
  if (requestPath === '/health' || requestPath === '/') {
    return next();
  }

  // Get the API key from header and trim it
  const rawApiKey = req.headers["x-api-key"];
  const apiKey = rawApiKey ? rawApiKey.trim() : null;

  // Check if API key is provided
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: {
        type: 'Unauthorized',
        message: 'Missing API key. Please provide X-API-Key header.',
      },
    });
  }

  // If no valid keys are configured, treat as misconfiguration (but still deny)
  if (hashedKeys.length === 0) {
    return res.status(401).json({
      success: false,
      error: {
        type: 'Unauthorized',
        message: 'API key authentication is enabled but no valid keys are configured.',
      },
    });
  }

  // Hash the incoming key with SHA-256 for secure comparison
  const incomingHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  // Validate the provided key's hash using constant-time comparison to prevent timing attacks
  let matchedKey = null;
  for (const entry of hashedKeys) {
    try {
      if (
        entry.hash.length === incomingHash.length &&
        crypto.timingSafeEqual(
          Buffer.from(entry.hash),
          Buffer.from(incomingHash),
        )
      ) {
        matchedKey = entry;
        break;
      }
    } catch (err) {
      // Continue checking other keys
    }
  }

  if (!matchedKey) {
    return res.status(401).json({
      success: false,
      error: {
        type: 'Unauthorized',
        message: 'Invalid API key.',
      },
    });
  }

  // Operational endpoints require an admin-scoped key.
  if (isAdminPath(req) && matchedKey.scope !== 'admin') {
    return res.status(403).json({
      success: false,
      error: {
        type: 'InsufficientScope',
        message: 'This API key does not have the scope required for this endpoint.',
        requiredScope: 'admin',
      },
    });
  }

  // Key is valid and scoped for this route, proceed to next middleware
  next();
};

module.exports = apiKeyMiddleware;
