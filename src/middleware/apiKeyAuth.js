// API Key Authentication Middleware
// Optional mode: activated via REQUIRE_API_KEY=true env var
// Clients send key via X-API-Key header
// Keys configurable via API_KEYS env var (comma-separated)
// Returns 401 for missing/invalid key when enabled
// /health and / endpoints are always public

const crypto = require('crypto');

// Load and hash all API keys on startup (module load)
let hashedKeys = [];

const rawKeys = process.env.API_KEYS;
if (rawKeys) {
  const keysArray = rawKeys.split(',').map(key => key.trim());
  hashedKeys = keysArray.map(key =>
    crypto.createHash('sha256').update(key).digest('hex')
  );

  // Clear plaintext keys from memory to prevent extraction if compromised
  for (let i = 0; i < keysArray.length; i++) {
    keysArray[i] = '';
  }
  delete process.env.API_KEYS;
}

const apiKeyMiddleware = (req, res, next) => {
  const requireApiKey = process.env.REQUIRE_API_KEY === 'true';

  // If API key authentication is not required, proceed to next middleware
  if (!requireApiKey) {
    return next();
  }

  // Allow public access to health check and root endpoint
  if (req.path === '/health' || req.path === '/') {
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
  let keyIsValid = false;
  for (const hashedKey of hashedKeys) {
    try {
      if (
        hashedKey.length === incomingHash.length &&
        crypto.timingSafeEqual(
          Buffer.from(hashedKey),
          Buffer.from(incomingHash),
        )
      ) {
        keyIsValid = true;
        break;
      }
    } catch (err) {
      // Continue checking other keys
    }
  }

  if (!keyIsValid) {
    return res.status(401).json({
      success: false,
      error: {
        type: 'Unauthorized',
        message: 'Invalid API key.',
      },
    });
  }

  // Key is valid, proceed to next middleware
  next();
};

module.exports = apiKeyMiddleware;