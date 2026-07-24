const StellarKitError = require("../utils/StellarKitError");

function rejectEmptyParam(req, res, next, value, name) {
  if (typeof value === "string" && value.trim() === "") {
    const err = new StellarKitError(
      `Route parameter '${name}' is required and cannot be empty.`,
      400,
      "MissingParameter",
      null,
      "Ensure all required parameters are included in the request URL."
    );
    return res.status(400).json({
      success: false,
      error: err.toJSON(),
    });
  }
  next();
}

function registerParamValidation(router) {
  const paramNames = [
    "id",
    "code",
    "issuer",
    "accountId",
    "assetCode",
    "assetIssuer",
    "sellAsset",
    "buyAsset",
  ];
  for (const name of paramNames) {
    router.param(name, rejectEmptyParam);
  }
}

module.exports = registerParamValidation;
