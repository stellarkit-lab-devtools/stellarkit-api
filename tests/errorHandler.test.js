const errorHandler = require("../src/middleware/errorHandler");
const { translateHorizonError } = require("../src/utils/horizonErrors");

describe("ErrorHandler Middleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = { method: "GET", path: "/test" };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
  });

  describe("Horizon Errors", () => {
    it("returns success:false and type HorizonError", () => {
      const err = {
        response: {
          status: 400,
          data: { title: "Transaction Failed", detail: "Bad request." },
        },
      };
      errorHandler(err, req, res, next);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error.type).toBe("HorizonError");
    });

    it("includes title and detail from Horizon response data", () => {
      const err = {
        response: {
          status: 400,
          data: { title: "My Title", detail: "My Detail" },
        },
      };
      errorHandler(err, req, res, next);
      const { error } = res.json.mock.calls[0][0];
      expect(error.title).toBe("My Title");
      expect(error.detail).toBe("My Detail");
    });

    it("maps tx_bad_seq result code to HTTP 409", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "Bad sequence.",
            extras: { result_codes: { transaction: "tx_bad_seq" } },
          },
        },
      };
      errorHandler(err, req, res, next);
      expect(res.status).toHaveBeenCalledWith(409);
      const { error } = res.json.mock.calls[0][0];
      expect(error.type).toBe("HorizonError");
      expect(error.title).toBe("Transaction Failed");
      expect(error.detail).toBe("Bad sequence.");
      expect(error.extras).toEqual(err.response.data.extras);
      expect(error.code).toBe("tx_bad_seq");
      expect(error.message).toBe(translateHorizonError("tx_bad_seq"));
    });

    it("maps op_no_destination result code to HTTP 404", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "Destination not found.",
            extras: { result_codes: { operations: ["op_no_destination"] } },
          },
        },
      };
      errorHandler(err, req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
      const { error } = res.json.mock.calls[0][0];
      expect(error.code).toBe("op_no_destination");
      expect(error.message).toBe(translateHorizonError("op_no_destination"));
    });

    it("falls back to err.response.status for unknown result codes", () => {
      const err = {
        response: {
          status: 418,
          data: {
            title: "Teapot",
            detail: "Unknown code.",
            extras: { result_codes: { transaction: "tx_unknown_code_example" } },
          },
        },
      };
      errorHandler(err, req, res, next);
      expect(res.status).toHaveBeenCalledWith(418);
      const { error } = res.json.mock.calls[0][0];
      // unknown code → included as code but no translated message
      expect(error.code).toBe("tx_unknown_code_example");
      expect(error.message).toBeUndefined();
    });

    it("falls back to err.response.status when no result codes present", () => {
      const err = {
        response: {
          status: 402,
          data: { title: "Payment Required", detail: "Some detail." },
        },
      };
      errorHandler(err, req, res, next);
      expect(res.status).toHaveBeenCalledWith(402);
      const { error } = res.json.mock.calls[0][0];
      expect(error.extras).toBeNull();
      // no resultCode → code and message fields absent
      expect(error.code).toBeUndefined();
      expect(error.message).toBeUndefined();
    });

    it("does not throw a ReferenceError (no undefined variable crash)", () => {
      const err = {
        response: {
          status: 400,
          data: { title: "Error", detail: "Detail." },
        },
      };
      expect(() => errorHandler(err, req, res, next)).not.toThrow();
    });

    it("omits code and message when resultCode is null (no extras)", () => {
      const err = {
        response: { status: 400, data: { title: "Error", detail: "Detail." } },
      };
      errorHandler(err, req, res, next);
      const { error } = res.json.mock.calls[0][0];
      expect(Object.keys(error)).not.toContain("code");
      expect(Object.keys(error)).not.toContain("message");
    });

    it("includes code but omits message for unrecognised result code", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Error",
            detail: "Detail.",
            extras: { result_codes: { transaction: "tx_not_in_map" } },
          },
        },
      };
      errorHandler(err, req, res, next);
      const { error } = res.json.mock.calls[0][0];
      expect(error.code).toBe("tx_not_in_map");
      expect(Object.keys(error)).not.toContain("message");
    });

    it("includes translated message for recognised tx code tx_bad_auth", () => {
      const err = {
        response: {
          status: 400,
          data: {
            title: "Transaction Failed",
            detail: "Bad auth.",
            extras: { result_codes: { transaction: "tx_bad_auth" } },
          },
        },
      };
      errorHandler(err, req, res, next);
      const { error } = res.json.mock.calls[0][0];
      expect(error.message).toBe(translateHorizonError("tx_bad_auth"));
    });
  });

  describe("Payload Too Large Errors", () => {
    it("returns 413 with PayloadTooLargeError type for entity.too.large", () => {
      const err = { type: "entity.too.large" };
      errorHandler(err, req, res, next);
      expect(res.status).toHaveBeenCalledWith(413);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error.type).toBe("PayloadTooLargeError");
    });
  });

  describe("Validation Errors", () => {
    it("returns 400 with ValidationError type", () => {
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
        },
      });
    });
  });

  describe("Generic Errors", () => {
    it("returns 500 with ServerError type", () => {
      const err = new Error("Database connection failed");
      errorHandler(err, req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { type: "ServerError", message: "Database connection failed" },
      });
    });
  });
});
