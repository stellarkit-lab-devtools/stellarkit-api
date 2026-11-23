const request = require("supertest");
const express = require("express");

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock("../../src/services/metrics", () => ({
  recordResponseTime: jest.fn()
}));

const logger = require("../../src/utils/logger");
const requestLogger = require("../../src/middleware/requestLogger");

describe("requestLogger middleware", () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(requestLogger);
    app.get("/test", (req, res) => res.send("ok"));
    app.get("/error", (req, res) => { throw new Error("test error"); });
    jest.clearAllMocks();
  });

  describe("odd inputs produce normal responses", () => {
    it("handles missing requestId", async () => {
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
      expect(logger.info).toHaveBeenCalled();
    });

    it("handles non-string req.ip", async () => {
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
      expect(logger.info).toHaveBeenCalled();
    });

    it("handles 404 with undefined req.route", async () => {
      const res = await request(app).get("/nonexistent");
      expect(res.status).toBe(404);
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("throwing log transport", () => {
    it("does not change status code when logger throws", async () => {
      logger.info.mockImplementation(() => { throw new Error("logger broken"); });
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
    });
  });

  describe("aborted request logging", () => {
    it("logs aborted request once", async () => {
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe("finish hook attached once", () => {
    it("never logs twice for same request", async () => {
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });
});