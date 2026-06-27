const { StellarKitError } = require('./StellarKitError') || {};

/**
 * Middleware: intercept Horizon 404 for accounts and return a clear error.
 * Replaces the raw Horizon message with a structured actionable response.
 */
const handleAccountNotFound = (err, req, res, next) => {
  const isHorizonNotFound =
    err?.response?.status === 404 ||
    err?.status === 404 ||
    (typeof err?.message === 'string' && err.message.includes('Account not found'));

  if (isHorizonNotFound && req.path?.includes('/account/')) {
    return res.status(404).json({
      success: false,
      error: {
        type: 'ACCOUNT_NOT_FOUND',
        message: 'This Stellar account does not exist on the network.',
        hint: 'Verify the address is correct and the account has been funded with at least 1 XLM.',
        address: req.params?.id || req.params?.address || null,
      },
    });
  }
  return next(err);
};

module.exports = { handleAccountNotFound };
