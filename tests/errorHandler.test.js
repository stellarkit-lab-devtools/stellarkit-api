const errorHandler = require("../src/middleware/errorHandler");

describe("ErrorHandler Middleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      method: "GET",
      path: "/test",
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  describe("Horizon Errors", () => {
    it("should map transaction result code tx_bad_seq to 409 status code", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "The transaction failed due to bad sequence.",
            extras: {
              result_codes: {
                transaction: "tx_bad_seq",
              },
            },
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "HorizonError",
          title: "Transaction Failed",
          detail: "The transaction failed due to bad sequence.",
          status: 400,
          extras: err.response.data.extras,
          code: "tx_bad_seq",
          message: "Transaction sequence number does not match the account's current sequence. Reload the account and rebuild the transaction.",
        },
      });
    });

    it("should map operation result code op_no_destination to 404 status code", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "The destination account was not found.",
            extras: {
              result_codes: {
                operations: ["op_no_destination"],
              },
            },
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "HorizonError",
          title: "Transaction Failed",
          detail: "The destination account was not found.",
          status: 400,
          extras: err.response.data.extras,
          code: "op_no_destination",
          message: "The destination account does not exist. Create the account first with a createAccount operation.",
        },
      });
    });

    it("should fallback to err.response.status for unknown Horizon error codes", () => {
      const err = {
        response: {
          status: 418,
          data: {
            title: "Teapot",
            detail: "An unknown result code was returned.",
            extras: {
              result_codes: {
                transaction: "tx_unknown_code_example",
              },
            },
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(418);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "HorizonError",
          title: "Teapot",
          detail: "An unknown result code was returned.",
          status: 418,
          extras: err.response.data.extras,
          code: "tx_unknown_code_example",
        },
      });
    });

    it("should fallback to err.response.status when no result codes are present", () => {
      const err = {
        response: {
          status: 402,
          data: {
            title: "Payment Required",
            detail: "Horizon responded with payment required.",
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "HorizonError",
          title: "Payment Required",
          detail: "Horizon responded with payment required.",
          status: 402,
          extras: null,
        },
      });
    });

    it("should include code and human-readable message for known result codes", () => {
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

      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error.type).toBe("HorizonError");
      expect(body.error.code).toBe("tx_bad_seq");
      expect(typeof body.error.message).toBe("string");
      expect(body.error.message.length).toBeGreaterThan(0);
    });

    it("should include code and message for known operation result codes", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "No destination.",
            extras: { result_codes: { operations: ["op_no_destination"] } },
          },
        },
      };

      errorHandler(err, req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.error.type).toBe("HorizonError");
      expect(body.error.code).toBe("op_no_destination");
      expect(body.error.message).toBeTruthy();
    });

    it("should omit code and message for unknown result codes", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "Unknown code.",
            extras: { result_codes: { transaction: "tx_unknown_xyz" } },
          },
        },
      };

      errorHandler(err, req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.error.type).toBe("HorizonError");
      expect(body.error).not.toHaveProperty("message");
      // code is still present because resultCode is non-null
      expect(body.error.code).toBe("tx_unknown_xyz");
    });

    it("should not throw a ReferenceError when handling a HorizonError", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "Some detail.",
            extras: { result_codes: { transaction: "tx_bad_seq" } },
          },
        },
      };

      expect(() => errorHandler(err, req, res, next)).not.toThrow();
      expect(res.json).toHaveBeenCalled();
      expect(res.json.mock.calls[0][0].success).toBe(false);
    });

    it("should use horizonError.status over err.response.status when present", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Not Found",
            detail: "Resource not found.",
            status: 404,
          },
        },
      };

      errorHandler(err, req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.error.status).toBe(404);
    });

    it("should default title and detail when missing from horizonError", () => {
      const err = {
        response: {
          status: 400,
          data: {},
        },
      };

      errorHandler(err, req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.error.title).toBe("Horizon Error");
      expect(body.error.detail).toBe("An error occurred with the Stellar network.");
      expect(body.error.extras).toBeNull();
    });
  });

  describe("Validation Errors", () => {
    it("should handle custom validation errors with a 400 status code", () => {
      const err = {
        isValidation: true,
        message: "Invalid Account ID format",
        field: "accountId",
        receivedValue: "G12345",
        expectedFormat: "G... public key",
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "ValidationError",
          message: "Invalid Account ID format",
          field: "accountId",
          receivedValue: "G12345",
          expectedFormat: "G... public key",
          suggestion: "Expected format: G... public key",
        },
      });
    });
  });

  describe("Generic Errors", () => {
    it("should handle generic ServerError with a 500 status code", () => {
      const err = new Error("Database connection failed");

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "ServerError",
          message: "Database connection failed",
        },
      });
    });
  });
});
