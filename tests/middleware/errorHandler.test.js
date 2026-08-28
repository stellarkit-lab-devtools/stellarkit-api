const errorHandler = require("../../src/middleware/errorHandler");
const StellarKitError = require("../../src/utils/StellarKitError");

function createMocks() {
  const req = { method: "GET", path: "/test", requestId: "req-572-test" };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe("errorHandler middleware — full coverage", () => {
  describe("generic error returns 500", () => {
    it("should return 500 and ServerError type for a plain Error", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Something went wrong");

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { type: "ServerError", message: "Something went wrong" },
        requestId: "req-572-test",
      });
    });

    it("should hide error details in production mode", () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      const { req, res, next } = createMocks();
      const err = new Error("Sensitive details");

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { type: "ServerError", message: "An unexpected error occurred." },
        requestId: "req-572-test",
      });
      process.env.NODE_ENV = origEnv;
    });
  });

  describe("error with custom statusCode uses that code", () => {
    it("should use the error's statusCode when present", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Custom status");
      err.statusCode = 422;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
    });

    it("should prefer statusCode over status when both are set", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Conflict");
      err.statusCode = 409;
      err.status = 400;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
    });
  });

  describe("error with suggestion includes suggestion in response", () => {
    it("should include suggestion when the error has one", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Resource not available");
      err.statusCode = 503;
      err.suggestion = "Try again later or contact support.";

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "ServerError",
          message: "Resource not available",
          suggestion: "Try again later or contact support.",
        },
        requestId: "req-572-test",
      });
    });
  });

  describe("Horizon error returns structured shape", () => {
    it("should return a structured Horizon error shape with known code", () => {
      const { req, res, next } = createMocks();
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "Bad sequence number.",
            extras: { result_codes: { transaction: "tx_bad_seq" } },
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "HorizonError",
          title: "Transaction Failed",
          detail: "Bad sequence number.",
          status: 400,
          extras: { result_codes: { transaction: "tx_bad_seq" } },
          code: "tx_bad_seq",
          message: "Transaction sequence number does not match the account's current sequence. Reload the account and rebuild the transaction.",
        },
        requestId: "req-572-test",
      });
    });

    it("should include all standard fields in the structured shape", () => {
      const { req, res, next } = createMocks();
      const err = {
        response: {
          status: 404,
          data: {
            title: "Not Found",
            detail: "Resource missing.",
          },
        },
      };

      errorHandler(err, req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error).toHaveProperty("type", "HorizonError");
      expect(body.error).toHaveProperty("title");
      expect(body.error).toHaveProperty("detail");
      expect(body.error).toHaveProperty("status");
      expect(body.error).toHaveProperty("extras");
    });

    it("should default title and detail when missing", () => {
      const { req, res, next } = createMocks();
      const err = {
        response: { status: 400, data: {} },
      };

      errorHandler(err, req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.error.title).toBe("Horizon Error");
      expect(body.error.detail).toBe("Horizon Error");
      expect(body.error.extras).toBeNull();
    });

    it("should handle result_codes without transaction or operations", () => {
      const { req, res, next } = createMocks();
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "Unknown result code structure.",
            extras: { result_codes: {} },
          },
        },
      };

      errorHandler(err, req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.error.code).toBeUndefined();
      expect(body.error.message).toBeUndefined();
    });

    it("should handle op_low_reserve as InsufficientReserve", () => {
      const { req, res, next } = createMocks();
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "Low reserve.",
            extras: { result_codes: { operations: ["op_low_reserve"] } },
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InsufficientReserve",
          message: "Account does not have enough XLM to cover the minimum reserve requirement.",
          suggestion: "Fund the account with additional XLM. Each account requires a base reserve of 1 XLM plus 0.5 XLM per subentry.",
        },
        requestId: "req-572-test",
      });
    });
  });

  describe("TransactionSubmissionFailed", () => {
    it("should return TransactionSubmissionFailed for Horizon errors with type transaction_failed", () => {
      const { req, res, next } = createMocks();
      const err = {
        response: {
          status: 400,
          data: {
            type: "transaction_failed",
            title: "Transaction Failed",
            detail: "Bad sequence.",
            extras: { result_codes: { transaction: "tx_bad_seq" } },
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "TransactionSubmissionFailed",
          title: "Transaction Failed",
          detail: "Bad sequence.",
          message: "Transaction sequence number does not match the account's current sequence. Reload the account and rebuild the transaction.",
          resultCodes: { transaction: "tx_bad_seq" },
          code: "tx_bad_seq",
        },
        requestId: "req-572-test",
      });
    });
  });

  describe("StellarKitError", () => {
    it("should handle StellarKitError with all fields", () => {
      const { req, res, next } = createMocks();
      const err = new StellarKitError("Custom error", 418, "CustomType", "Extra detail", "Try something else");

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(418);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "CustomType",
          message: "Custom error",
          detail: "Extra detail",
          suggestion: "Try something else",
        },
        requestId: "req-572-test",
      });
    });

    it("should handle StellarKitError without optional fields", () => {
      const { req, res, next } = createMocks();
      const err = new StellarKitError("Minimal error", 400, "MinimalType");

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { type: "MinimalType", message: "Minimal error" },
        requestId: "req-572-test",
      });
    });
  });

  describe("ReferenceError and TypeError", () => {
    it("should handle ReferenceError with 500", () => {
      const { req, res, next } = createMocks();
      const err = new ReferenceError("x is not defined");

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InternalError",
          title: "Internal Server Error",
          detail: "x is not defined",
        },
        requestId: "req-572-test",
      });
    });

    it("should handle TypeError with 500", () => {
      const { req, res, next } = createMocks();
      const err = new TypeError("Cannot read property of undefined");

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InternalError",
          title: "Internal Server Error",
          detail: "Cannot read property of undefined",
        },
        requestId: "req-572-test",
      });
    });

    it("should hide ReferenceError details in production", () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      const { req, res, next } = createMocks();
      const err = new ReferenceError("x is not defined");

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InternalError",
          title: "Internal Server Error",
          detail: "An unexpected error occurred.",
        },
        requestId: "req-572-test",
      });
      process.env.NODE_ENV = origEnv;
    });
  });

  describe("PayloadTooLarge", () => {
    it("should handle entity.too.large type", () => {
      const { req, res, next } = createMocks();
      const err = { type: "entity.too.large" };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "PayloadTooLargeError",
          message: "Payload too large. Maximum request body size is 10kb.",
          suggestion: "Reduce your request body size to under 10kb.",
        },
        requestId: "req-572-test",
      });
    });

    it("should handle status 413", () => {
      const { req, res, next } = createMocks();
      const err = { status: 413 };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ type: "PayloadTooLargeError" }),
        })
      );
    });
  });

  describe("Connection errors", () => {
    it("should return 503 for ECONNREFUSED", () => {
      const { req, res, next } = createMocks();
      const err = new Error("connect ECONNREFUSED");
      err.code = "ECONNREFUSED";

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "HorizonUnavailable",
          message: "Unable to connect to the Stellar Horizon node.",
          suggestion: "Check your HORIZON_URL and verify the node is reachable. See https://status.stellar.org for network status.",
        },
        requestId: "req-572-test",
      });
    });
  });

  describe("Domain-specific not-found errors", () => {
    it("should handle isTransactionNotFound", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Transaction abc not found");
      err.isTransactionNotFound = true;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "NotFound",
          message: "Transaction abc not found",
          suggestion: "Verify the transaction hash is correct and exists on the network.",
        },
        requestId: "req-572-test",
      });
    });

    it("should handle isAccountNotFound", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Account GABCD not found");
      err.isAccountNotFound = true;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "AccountNotFound",
          message: "Account GABCD not found",
          suggestion: "Verify the account address is correct and that the account has been funded.",
        },
        requestId: "req-572-test",
      });
    });

    it("should handle isAssetNotFound", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Asset not found");
      err.isAssetNotFound = true;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "AssetNotFound",
          message: "Asset not found",
          suggestion: "Verify the asset code and issuer address are correct.",
        },
        requestId: "req-572-test",
      });
    });

    it("should handle isTrustlineNotFound", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Trustline not found for USDC");
      err.isTrustlineNotFound = true;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "TrustlineNotFound",
          message: "Trustline not found for USDC",
          suggestion: "The account must establish a trustline before holding this asset.",
        },
        requestId: "req-572-test",
      });
    });
  });

  describe("Validation-related errors", () => {
    it("should handle isInvalidAccountId", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Invalid account ID: G123");
      err.isInvalidAccountId = true;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InvalidAccountId",
          message: "Invalid account ID: G123",
          suggestion: "Account addresses start with G and are 56 characters long.",
        },
        requestId: "req-572-test",
      });
    });

    it("should handle isInvalidAccountId with custom suggestion", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Bad ID");
      err.isInvalidAccountId = true;
      err.suggestion = "Use a valid G address.";

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InvalidAccountId",
          message: "Bad ID",
          suggestion: "Use a valid G address.",
        },
        requestId: "req-572-test",
      });
    });

    it("should handle isInvalidAsset", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Invalid asset code");
      err.isInvalidAsset = true;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InvalidAsset",
          message: "Invalid asset code",
          suggestion: null,
        },
        requestId: "req-572-test",
      });
    });

    it("should handle isInvalidCursor", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Bad cursor");
      err.isInvalidCursor = true;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InvalidCursor",
          message: "Bad cursor",
          suggestion: "Use the cursor returned in the previous response.",
        },
        requestId: "req-572-test",
      });
    });

    it("should handle isInvalidCursor with custom suggestion", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Bad pagination");
      err.isInvalidCursor = true;
      err.suggestion = "Provide a valid cursor string.";

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InvalidCursor",
          message: "Bad pagination",
          suggestion: "Provide a valid cursor string.",
        },
        requestId: "req-572-test",
      });
    });

    it("should handle isInvalidLimit", () => {
      const { req, res, next } = createMocks();
      const err = new Error("limit out of range");
      err.isInvalidLimit = true;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InvalidLimit",
          message: "limit must be a number between 1 and 100.",
          suggestion: "Provide a valid integer for the limit parameter, e.g. ?limit=20",
        },
        requestId: "req-572-test",
      });
    });
  });

  describe("HorizonTimeout", () => {
    it("should return 504 for timeout errors", () => {
      const { req, res, next } = createMocks();
      const err = new Error("The Stellar Horizon node did not respond in time.");
      err.isHorizonTimeout = true;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "HorizonTimeout",
          message: "The Stellar Horizon node did not respond in time.",
          suggestion: "Try again in a few seconds. If the issue persists check the Stellar network status at https://status.stellar.org.",
        },
        requestId: "req-572-test",
      });
    });
  });

  describe("Offer not found errors", () => {
    it("should handle isOfferNotFound property", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Offer 456 not found");
      err.isOfferNotFound = true;
      err.offerId = "456";

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "OfferNotFound",
          message: "Offer '456' was not found on the Stellar testnet network.",
          suggestion: "The offer may have already been filled, cancelled, or the offer ID may be incorrect.",
        },
        requestId: "req-572-test",
      });
    });

    it("should handle Horizon offer 404 via isOfferNotFoundError", () => {
      const { req, res, next } = createMocks();
      const err = {
        response: {
          status: 404,
          config: { url: "https://horizon-testnet.stellar.org/offers/789" },
          data: {
            title: "Not Found",
            detail: "Resource missing.",
          },
        },
        offerId: "789",
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "OfferNotFound",
          message: "Offer '789' was not found on the Stellar testnet network.",
          suggestion: "The offer may have already been filled, cancelled, or the offer ID may be incorrect.",
        },
        requestId: "req-572-test",
      });
    });
  });

  describe("Validation errors (isValidation)", () => {
    it("should handle isValidation with all fields", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Invalid format");
      err.isValidation = true;
      err.field = "accountId";
      err.receivedValue = "abc";
      err.expectedFormat = "G...";

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "ValidationError",
          message: "Invalid format",
          field: "accountId",
          receivedValue: "abc",
          expectedFormat: "G...",
          suggestion: "Expected format: G...",
        },
        requestId: "req-572-test",
      });
    });

    it("should handle isValidation without expectedFormat", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Simple validation error");
      err.isValidation = true;
      err.field = "limit";
      err.receivedValue = "foo";

      errorHandler(err, req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.error.type).toBe("ValidationError");
      expect(body.error.field).toBe("limit");
      expect(body.error).not.toHaveProperty("suggestion");
    });
  });

  describe("request ID is included in all error responses", () => {
    it("should include requestId in error response when req.requestId is set", () => {
      const { req, res, next } = createMocks();
      const err = new Error("Test error with requestId");

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "req-572-test" })
      );
    });

    it("should set requestId to null when req.requestId is not set", () => {
      const req = { method: "GET", path: "/test" };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();
      const err = new Error("No request ID");

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: null })
      );
    });
  });
});