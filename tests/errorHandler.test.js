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
    it("maps a failed transaction submission (tx_bad_seq) to TransactionSubmissionFailed at 409", () => {
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
          type: "TransactionSubmissionFailed",
          message: "Transaction failed.",
          resultCodes: { transaction: "tx_bad_seq", operations: [] },
          suggestion:
            "Transaction sequence number does not match the account's current sequence. Reload the account and rebuild the transaction.",
        },
      });
    });

    it("maps a failed transaction submission (op_no_destination) to TransactionSubmissionFailed at 404", () => {
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
          type: "TransactionSubmissionFailed",
          message: "Transaction failed.",
          resultCodes: { transaction: null, operations: ["op_no_destination"] },
          suggestion:
            "The destination account does not exist. Create the account first with a createAccount operation.",
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

    describe("Account merge specific failures", () => {
      beforeEach(() => {
        req.path = "/account/GABC123456789012345678901234567890123456789012345678901234/merge";
      });

      it("returns AccountMergeFailed for op_does_not_exist", () => {
        const err = {
          response: {
            status: 400,
            data: {
              title: "Transaction Failed",
              detail: "Merge operation failed.",
              extras: { result_codes: { operations: ["op_does_not_exist"] } },
            },
          },
        };

        errorHandler(err, req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: {
            type: "AccountMergeFailed",
            message: "Account merge failed because the destination account does not exist.",
            resultCode: "op_does_not_exist",
            suggestion:
              "Use an existing funded destination account (G...) before retrying the merge.",
          },
        });
      });

      it("returns AccountMergeFailed for op_malformed", () => {
        const err = {
          response: {
            status: 400,
            data: {
              title: "Transaction Failed",
              detail: "Malformed operation.",
              extras: { result_codes: { operations: ["op_malformed"] } },
            },
          },
        };

        errorHandler(err, req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: {
            type: "AccountMergeFailed",
            message: "Account merge failed because the operation payload is malformed.",
            resultCode: "op_malformed",
            suggestion:
              "Check source/destination values and rebuild the transaction with a valid accountMerge operation.",
          },
        });
      });

      it("returns AccountMergeFailed for op_dest_full", () => {
        const err = {
          response: {
            status: 400,
            data: {
              title: "Transaction Failed",
              detail: "Destination full.",
              extras: { result_codes: { operations: ["op_dest_full"] } },
            },
          },
        };

        errorHandler(err, req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: {
            type: "AccountMergeFailed",
            message:
              "Account merge failed because the destination account cannot accept additional reserves or entries.",
            resultCode: "op_dest_full",
            suggestion:
              "Free capacity on the destination account (remove subentries or use a different destination) and try again.",
          },
        });
      });
    });
  });

  describe("Horizon Timeout Errors", () => {
    const horizonTimeoutBody = {
      success: false,
      error: {
        type: "HorizonTimeout",
        message: "The Stellar Horizon node did not respond in time.",
        suggestion:
          "Try again in a few seconds. If the issue persists check the Stellar network status at https://status.stellar.org.",
      },
    };

    it("should return 504 with HorizonTimeout shape for timeout message errors", () => {
      const err = new Error("Network timeout");

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith(horizonTimeoutBody);
    });

    it("should return 504 for ECONNABORTED errors", () => {
      const err = new Error("timeout of 10000ms exceeded");
      err.code = "ECONNABORTED";

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith(horizonTimeoutBody);
    });

    it("should return 504 for isHorizonTimeout flagged errors", () => {
      const err = new Error("The Stellar Horizon node did not respond in time.");
      err.isHorizonTimeout = true;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith(horizonTimeoutBody);
    });

    it("should not treat Horizon HTTP errors as timeout", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "Bad sequence.",
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ type: "HorizonError" }),
        })
      );
    });
  });

  describe("Connection and offer-specific errors", () => {
    it("should return a HorizonUnavailable response for connection errors", () => {
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
      });
    });

    it("should return an OfferNotFound response for offer-not-found Horizon errors", () => {
      const err = {
        response: {
          status: 404,
          config: { url: "https://horizon-testnet.stellar.org/offers/123" },
          data: {
            title: "Not Found",
            detail: "Offer 123 was not found.",
          },
        },
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "OfferNotFound",
          message: "Offer '123' was not found on the Stellar testnet network.",
          suggestion: "The offer may have already been filled, cancelled, or the offer ID may be incorrect.",
        },
      });
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

  describe("InsufficientXLMReserve Errors", () => {
    it("should handle custom insufficient XLM reserve errors with a 422 status code", () => {
      const err = {
        isInsufficientXLMReserve: true,
        message: "Account GABCDEF has insufficient XLM reserve on the Stellar testnet network. Available: 1.5 XLM, Required: 2.5 XLM, Shortfall: 1.0000000 XLM.",
        accountId: "GABCDEF",
        availableBalance: 1.5,
        requiredReserve: 2.5,
        shortfall: 1.0,
        suggestion: "Add more XLM to the account or remove unused subentries (e.g., trustlines, offers, data entries) to free up reserve.",
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InsufficientXLMReserve",
          message: err.message,
          accountId: "GABCDEF",
          availableBalance: 1.5,
          requiredReserve: 2.5,
          shortfall: 1.0,
          suggestion: "Add more XLM to the account or remove unused subentries (e.g., trustlines, offers, data entries) to free up reserve.",
        },
      });
    });

    it("should handle insufficient reserve error with zero available balance", () => {
      const err = {
        isInsufficientXLMReserve: true,
        message: "Account GXYZ has insufficient XLM reserve on the Stellar mainnet network. Available: 0 XLM, Required: 1 XLM, Shortfall: 1.0000000 XLM.",
        accountId: "GXYZ",
        availableBalance: 0,
        requiredReserve: 1,
        shortfall: 1,
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          type: "InsufficientXLMReserve",
          message: err.message,
          accountId: "GXYZ",
          availableBalance: 0,
          requiredReserve: 1,
          shortfall: 1,
          suggestion: "Add more XLM to the account or remove unused subentries (e.g., trustlines, offers, data entries) to free up reserve.",
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
