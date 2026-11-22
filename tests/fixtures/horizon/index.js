"use strict";

const fs = require("fs");
const path = require("path");

const FIXTURE_DIR = __dirname;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Recursively merge overrides into a deep-copied fixture. Arrays are replaced. */
function mergeOverrides(target, overrides) {
  if (!isPlainObject(overrides)) return overrides;
  const result = isPlainObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? mergeOverrides(result[key], value)
      : value;
  }
  return result;
}

/**
 * Load a realistic Horizon fixture as a fresh deep copy, with overrides
 * applied recursively.
 *
 * @param {string} name - File name in tests/fixtures/horizon (with or without .json)
 * @param {object} [overrides={}] - Fields to replace/merge into the copy
 */
function loadFixture(name, overrides = {}) {
  const fileName = name.endsWith(".json") ? name : `${name}.json`;
  const filePath = path.join(FIXTURE_DIR, fileName);
  if (!filePath.startsWith(FIXTURE_DIR + path.sep)) {
    throw new Error(`Invalid Horizon fixture name: ${name}`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Unknown Horizon fixture: ${name}`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return mergeOverrides(data, overrides);
}

module.exports = { loadFixture, FIXTURE_DIR };
