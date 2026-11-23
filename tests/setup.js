/**
 * Jest test setup - runs before each test file
 * 
 * This file:
 * 1. Flushes the cache service after each test to prevent test pollution
 * 2. Restores mocks after each test (requires Jest config: resetMocks, restoreMocks)
 */

const cacheService = require("../src/services/cache");

// Flush cache after each test to prevent state leakage between tests
afterEach(() => {
  cacheService.flush();
});

// Clean up any timers that might be left open
afterEach(() => {
  jest.clearAllTimers();
});

// Ensure all mocks are restored after each test
// This requires Jest config to have: resetMocks: true, restoreMocks: true
afterEach(() => {
  if (jest.restoreAllMocks) {
    jest.restoreAllMocks();
  }
});

// Optional: Log any open handles detected during tests
// This helps identify resource leaks
afterEach(async () => {
  // Give any async operations a moment to complete
  await new Promise(resolve => setTimeout(resolve, 0));
});

// Global beforeAll to ensure clean state
beforeAll(() => {
  // Ensure cache starts empty
  cacheService.flush();
});

// Reset module state between test runs if needed
beforeEach(() => {
  // Clear any module-level mocks
  jest.clearAllMocks();
});