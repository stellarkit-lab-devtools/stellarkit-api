/**
 * ETag middleware for caching support.
 * Generates an ETag from the response body and sets it in the response header.
 * Returns 304 Not Modified if the client's If-None-Match header matches the current ETag.
 *
 * Usage:
 *   const etagMiddleware = require('./etagMiddleware');
 *   router.get('/my-endpoint', etagMiddleware, (req, res) => {
 *     res.json({ data: 'value' });
 *   });
 */

const crypto = require('crypto');

/**
 * Generates an ETag from a string by computing its SHA256 hash.
 * @param {string} content - The content to generate an ETag from
 * @returns {string} The ETag string (quoted hash)
 */
function generateETag(content) {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `"${hash}"`;
}

/**
 * ETag middleware that should be applied BEFORE route handlers.
 * It intercepts the response to calculate and set ETags.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Express next function
 */
function etagMiddleware(req, res, next) {
  // Only apply ETag logic to GET requests
  if (req.method !== 'GET') {
    return next();
  }

  // Store the original json method
  const originalJson = res.json.bind(res);

  // Override the json method to intercept the response
  res.json = function (data) {
    // Only apply ETag logic for successful responses (200-299)
    const statusCode = res.statusCode;
    if (statusCode >= 200 && statusCode < 300) {
      // Serialize the data to JSON to calculate the ETag
      const jsonString = JSON.stringify(data);
      const etag = generateETag(jsonString);

      // Check if the client sent an If-None-Match header
      const clientETag = req.get('If-None-Match');
      if (clientETag && clientETag === etag) {
        // Client has the same version, return 304 Not Modified
        res.set('ETag', etag);
        res.set('Cache-Control', 'public, max-age=3600');
        return res.status(304).end();
      }

      // Set the ETag header for new/updated responses
      res.set('ETag', etag);
      res.set('Cache-Control', 'public, max-age=3600');
    }

    // Call the original json method
    return originalJson(data);
  };

  next();
}

module.exports = etagMiddleware;
