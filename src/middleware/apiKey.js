// API Key Authentication Middleware
// Optional mode: activated via REQUIRE_API_KEY=true env var
// Clients send key via X-API-Key header
// Keys configurable via API_KEYS env var (comma-separated)
// Returns 401 for missing/invalid key when enabled
// /health and / endpoints are always public

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

  // Get the API key from header
  const apiKey = req.headers['x-api-key'];

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

  // Get valid keys from environment variable (comma-separated)
  const validKeys = process.env.API_KEYS
    ? process.env.API_KEYS.split(',').map(key => key.trim())
    : [];

  // If no valid keys are configured, treat as misconfiguration (but still deny)
  if (validKeys.length === 0) {
    return res.status(401).json({
      success: false,
      error: {
        type: 'Unauthorized',
        message: 'API key authentication is enabled but no valid keys are configured.',
      },
    });
  }

  // Validate the provided key
  if (!validKeys.includes(apiKey)) {
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