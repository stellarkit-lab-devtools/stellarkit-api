// Fixture for tests/checkRequires.test.js: every relative require resolves.
// A commented-out require of a missing file must be ignored:
// const gone = require("./does-not-exist");
const helper = require("./helper");
const lib = require("./lib");
const data = require("./data.json");
const url = "https://example.com//require('./not-a-require')";

module.exports = { helper, lib, data, url };
