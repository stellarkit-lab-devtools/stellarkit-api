const crypto = require("crypto");

/**
 * HMAC-SHA256 webhook signature verification middleware.
 * 
 * Verifies X-Webhook-Signature header using WEBHOOK_ADMIN_SECRET.
 * Signature is computed as: HMAC-SHA256(request body, secret)
 * 
 * Applied to all /webhooks/* endpoints to protect webhook management.
 * 
 * @returns {Function} Express middleware
 */
function webhookSignatureAuth(req, res, next) {
  const secret = process.env.WEBHOOK_ADMIN_SECRET;

  // If secret not configured, deny all requests
  if (!secret) {
    return res.status(401).json({
      success: false,
      error: {
        type: "Unauthorized",
        message: "Webhook admin secret not configured.",
      },
    });
  }

  const signature = req.headers["x-webhook-signature"];

  // Missing signature header
  if (!signature) {
    return res.status(401).json({
      success: false,
      error: {
        type: "Unauthorized",
        message: "Missing X-Webhook-Signature header.",
      },
    });
  }

  // Compute expected signature from raw body
  const bodyString = req.rawBody || JSON.stringify(req.body || {});
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(bodyString)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  let isValid = false;
  try {
    if (
      signature.length === expectedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      isValid = true;
    }
  } catch (err) {
    // timingSafeEqual throws if buffers are different lengths
  }

  if (!isValid) {
    return res.status(401).json({
      success: false,
      error: {
        type: "Unauthorized",
        message: "Invalid webhook signature.",
      },
    });
  }

  next();
}

module.exports = webhookSignatureAuth;
