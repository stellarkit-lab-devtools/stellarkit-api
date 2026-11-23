const crypto = require("crypto");

/** Default rotation window when WEBHOOK_ADMIN_SECRET_PREVIOUS is set but no
 *  explicit window is configured: 24 hours. */
const DEFAULT_ROTATION_WINDOW_MS = 24 * 60 * 60 * 1000;

// Secrets are picked up from env vars at process start (rotation requires a
// restart per the module docs below), so the rotation window is measured
// from when this module was loaded rather than from a persisted timestamp.
const rotationStartedAt = Date.now();

function computeSignature(secret, bodyString) {
  return crypto.createHmac("sha256", secret).update(bodyString).digest("hex");
}

function signaturesMatch(signature, expectedSignature) {
  try {
    return (
      signature.length === expectedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    );
  } catch (err) {
    // timingSafeEqual throws if buffers are different lengths
    return false;
  }
}

/**
 * HMAC-SHA256 webhook signature verification middleware.
 *
 * Verifies X-Webhook-Signature header using WEBHOOK_ADMIN_SECRET.
 * Signature is computed as: HMAC-SHA256(request body, secret)
 *
 * Zero-downtime secret rotation:
 *   Setting WEBHOOK_ADMIN_SECRET_PREVIOUS causes signatures computed with
 *   either WEBHOOK_ADMIN_SECRET or WEBHOOK_ADMIN_SECRET_PREVIOUS to be
 *   accepted, for WEBHOOK_ADMIN_SECRET_ROTATION_WINDOW_MS milliseconds
 *   (default 24h) after this module loads. After the window elapses, only
 *   WEBHOOK_ADMIN_SECRET is accepted.
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

  const candidateSecrets = [secret];
  const previousSecret = process.env.WEBHOOK_ADMIN_SECRET_PREVIOUS;
  if (previousSecret) {
    const rotationWindowMs = Number(
      process.env.WEBHOOK_ADMIN_SECRET_ROTATION_WINDOW_MS ?? DEFAULT_ROTATION_WINDOW_MS,
    );
    const withinRotationWindow =
      Number.isFinite(rotationWindowMs) && Date.now() - rotationStartedAt < rotationWindowMs;
    if (withinRotationWindow) {
      candidateSecrets.push(previousSecret);
    }
  }

  // Constant-time comparison to prevent timing attacks
  const isValid = candidateSecrets.some((candidate) =>
    signaturesMatch(signature, computeSignature(candidate, bodyString)),
  );

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
