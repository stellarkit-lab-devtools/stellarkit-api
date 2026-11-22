// Fixture for tests/checkRequires.test.js: deliberately broken requires.
const present = require("./present");
const missing = require("./missing-module");
jest.mock("../nowhere/config");

module.exports = { present, missing };
