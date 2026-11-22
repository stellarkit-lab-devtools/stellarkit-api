#!/usr/bin/env node
/**
 * check-requires.js
 *
 * Statically walks the given directories (default: src/ and tests/) and
 * reports every relative require() — plus require.resolve(), jest.mock(),
 * jest.doMock() and jest.requireActual() — whose path does not resolve to a
 * file on disk. A broken relative require only fails at runtime when the
 * module that contains it is loaded, so this catches it ahead of time.
 *
 * Comments are stripped before scanning, so example code in JSDoc blocks is
 * ignored. Directories named node_modules, coverage or fixtures are skipped
 * (fixtures hold deliberately broken files used to test this script).
 *
 * Usage:
 *   npm run check:requires
 *   node scripts/check-requires.js [dir ...]
 *
 * Exits with code 1 when at least one unresolved require is found.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DIRS = ["src", "tests"];
const SKIP_DIRS = new Set(["node_modules", "coverage", "fixtures", ".git"]);
const SOURCE_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".ts"]);
const RESOLVE_EXTENSIONS = [".js", ".cjs", ".mjs", ".json", ".ts", ".node"];

const REQUIRE_PATTERN =
  /\b(?:require(?:\.resolve)?|jest\.(?:mock|doMock|requireActual|unmock))\s*\(\s*(['"`])(\.{1,2}\/[^'"`]*?)\1/g;

/**
 * Replaces comments with whitespace while leaving string and template
 * literals intact, so "//" inside a URL string is not treated as a comment.
 * Newlines are preserved so reported line numbers stay accurate.
 *
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      while (i < len && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < len) {
        out += "  ";
        i += 2;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < len && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < len) {
          out += source[i] + source[i + 1];
          i += 2;
          continue;
        }
        if (quote !== "`" && source[i] === "\n") break;
        out += source[i];
        i++;
      }
      if (i < len) {
        out += source[i];
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Returns true when `request`, required from `fromFile`, resolves to a file
 * using Node's lookup rules for relative paths (exact file, file + extension,
 * directory with package.json "main" or index file).
 *
 * @param {string} fromFile
 * @param {string} request
 * @returns {boolean}
 */
function resolves(fromFile, request) {
  const target = path.resolve(path.dirname(fromFile), request);

  if (isFile(target)) return true;
  if (RESOLVE_EXTENSIONS.some((ext) => isFile(target + ext))) return true;

  if (isDirectory(target)) {
    const pkgPath = path.join(target, "package.json");
    if (isFile(pkgPath)) {
      try {
        const { main } = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (main && resolves(path.join(target, "index.js"), `./${main}`)) {
          return true;
        }
      } catch {
        // Fall through to the index lookup.
      }
    }
    return RESOLVE_EXTENSIONS.some((ext) => isFile(path.join(target, `index${ext}`)));
  }

  return false;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recursively lists source files under `dir`, skipping SKIP_DIRS.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  if (!isDirectory(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) files.push(...walk(full));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      if (!entry.name.endsWith(".d.ts")) files.push(full);
    }
  }
  return files;
}

/**
 * Scans a single file and returns its unresolved relative requires.
 *
 * @param {string} file - Absolute path
 * @returns {{ file: string, line: number, request: string }[]}
 */
function checkFile(file) {
  const source = stripComments(fs.readFileSync(file, "utf8"));
  const problems = [];
  REQUIRE_PATTERN.lastIndex = 0;
  let match;
  while ((match = REQUIRE_PATTERN.exec(source)) !== null) {
    const request = match[2];
    // Template literals with interpolation are dynamic; skip them.
    if (match[1] === "`" && request.includes("${")) continue;
    if (!resolves(file, request)) {
      const line = source.slice(0, match.index).split("\n").length;
      problems.push({ file, line, request });
    }
  }
  return problems;
}

/**
 * Checks every source file under the given directories.
 *
 * @param {string[]} [dirs] - Directories to scan (absolute or relative to the repo root)
 * @returns {{ file: string, line: number, request: string }[]}
 */
function checkRequires(dirs = DEFAULT_DIRS) {
  return dirs
    .map((dir) => path.resolve(ROOT, dir))
    .flatMap(walk)
    .flatMap(checkFile);
}

function main() {
  const dirs = process.argv.slice(2);
  const problems = checkRequires(dirs.length > 0 ? dirs : DEFAULT_DIRS);

  if (problems.length === 0) {
    console.log("check-requires: all relative requires resolve.");
    return 0;
  }

  console.error(`check-requires: ${problems.length} unresolved relative require(s):`);
  for (const { file, line, request } of problems) {
    console.error(`  ${path.relative(ROOT, file)}:${line}  ${request}`);
  }
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { checkRequires, checkFile, stripComments, resolves };
