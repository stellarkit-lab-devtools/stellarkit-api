const apiKeyMiddleware = require("../src/middleware/apiKey");

describe("API Key Middleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      path: "/",
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
    jest.resetModules();
  });

  describe("When API key authentication is not required", () => {
    beforeEach(() => {
      process.env.REQUIRE_API_KEY = "false";
    });

    it("should call next()", () => {
      apiKeyMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("When API key authentication is required", () => {
    beforeEach(() => {
      process.env.REQUIRE_API_KEY = "true";
      process.env.API_KEYS = "validkey1,validkey2";
    });

    describe("for public paths", () => {
      it("should allow access to /health", () => {
        req.path = "/health";
        apiKeyMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
      });

      it("should allow access to /", () => {
        req.path = "/";
        apiKeyMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
      });
    });

    describe("for protected paths", () => {
      beforeEach(() => {
        req.path = "/account/test";
      });

      it("should return 401 when no API key header is provided", () => {
        apiKeyMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: {
            type: "Unauthorized",
            message: "Missing API key. Please provide X-API-Key header.",
          },
        });
      });

      it("should return 401 when API key header is empty", () => {
        req.headers["x-api-key"] = "";
        apiKeyMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: {
            type: "Unauthorized",
            message: "Missing API key. Please provide X-API-Key header.",
          },
        });
      });

      it("should return 401 when API key is invalid", () => {
        req.headers["x-api-key"] = "invalidkey";
        apiKeyMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: {
            type: "Unauthorized",
            message: "Invalid API key.",
          },
        });
      });

      it("should call next() when API key is valid", () => {
        req.headers["x-api-key"] = "validkey1";
        apiKeyMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      });

      it("should trim whitespace in API key header", () => {
        req.headers["x-api-key"] = " validkey1 ";
        apiKeyMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
      });

      it("should return 401 when API_KEYS is empty", () => {
        process.env.API_KEYS = "";
        req.headers["x-api-key"] = "somekey";
        apiKeyMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: {
            type: "Unauthorized",
            message: "API key authentication is enabled but no valid keys are configured.",
          },
        });
      });

      it("should return 401 when API_KEYS is not set", () => {
        delete process.env.API_KEYS;
        req.headers["x-api-key"] = "somekey";
        apiKeyMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: {
            type: "Unauthorized",
            message: "API key authentication is enabled but no valid keys are configured.",
          },
        });
      });
    });
  });
});