const { installProcessHandlers, FATAL_EXIT_DELAY_MS } = require("../../src/services/processHandlers");

describe("processHandlers service", () => {
  let mockExit;
  let originalUnhandledRejection;
  let originalUncaughtException;

  beforeEach(() => {
    mockExit = jest.fn();
    jest.useFakeTimers();
    jest.clearAllMocks();
    
    originalUnhandledRejection = process.listeners("unhandledRejection");
    originalUncaughtException = process.listeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    process.removeAllListeners("uncaughtException");
  });

  afterEach(() => {
    originalUnhandledRejection.forEach(l => process.on("unhandledRejection", l));
    originalUncaughtException.forEach(l => process.on("uncaughtException", l));
    jest.useRealTimers();
  });

  describe("unhandled rejection handling", () => {
    it("logs fatal entry and exits on unhandled rejection", () => {
      const mockLogger = { fatal: jest.fn() };
      jest.doMock("../../src/utils/logger", () => mockLogger);
      jest.resetModules();
      
      const { installProcessHandlers } = require("../../src/services/processHandlers");
      installProcessHandlers({ exit: mockExit });

      const reason = new Error("test rejection");
      process.emit("unhandledRejection", reason);

      expect(mockLogger.fatal).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("uncaught exception handling", () => {
    it("logs fatal entry and exits on uncaught exception", () => {
      const mockLogger = { fatal: jest.fn() };
      jest.doMock("../../src/utils/logger", () => mockLogger);
      jest.resetModules();
      
      const { installProcessHandlers } = require("../../src/services/processHandlers");
      installProcessHandlers({ exit: mockExit });

      const err = new Error("test exception");
      process.emit("uncaughtException", err);

      expect(mockLogger.fatal).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("single-exit guarantee", () => {
    it("does not trigger second exit during delay", () => {
      const mockLogger = { fatal: jest.fn() };
      jest.doMock("../../src/utils/logger", () => mockLogger);
      jest.resetModules();
      
      const { installProcessHandlers } = require("../../src/services/processHandlers");
      installProcessHandlers({ exit: mockExit });

      process.emit("unhandledRejection", new Error("first"));
      process.emit("unhandledRejection", new Error("second"));

      expect(mockExit).toHaveBeenCalledTimes(1);
    });
  });

  describe("idempotent install", () => {
    it("registers handlers only once", () => {
      const mockLogger = { fatal: jest.fn() };
      jest.doMock("../../src/utils/logger", () => mockLogger);
      jest.resetModules();
      
      const { installProcessHandlers } = require("../../src/services/processHandlers");
      installProcessHandlers({ exit: mockExit });
      installProcessHandlers({ exit: mockExit });

      const listeners = process.listeners("unhandledRejection");
      expect(listeners.length).toBe(1);
    });
  });

  describe("exit delay", () => {
    it("waits FATAL_EXIT_DELAY_MS before exiting", () => {
      const mockLogger = { fatal: jest.fn() };
      jest.doMock("../../src/utils/logger", () => mockLogger);
      jest.resetModules();
      
      const { installProcessHandlers } = require("../../src/services/processHandlers");
      installProcessHandlers({ exit: mockExit });

      process.emit("unhandledRejection", new Error("test"));

      expect(mockExit).not.toHaveBeenCalled();
      jest.advanceTimersByTime(FATAL_EXIT_DELAY_MS);
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});