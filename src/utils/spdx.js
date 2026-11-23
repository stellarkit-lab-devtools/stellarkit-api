/**
 * Lightweight SPDX license expression evaluator.
 *
 * Evaluates SPDX expressions such as "MIT", "Apache-2.0", "MIT OR ISC",
 * "MIT AND Apache-2.0" against an allowlist of license identifiers.
 *
 * Supports:
 *   - Simple identifiers: "MIT"
 *   - OR expressions: "MIT OR ISC"
 *   - AND expressions: "MIT AND BSD-3-Clause"
 *   - Parenthesised sub-expressions: "(MIT OR ISC) AND Apache-2.0"
 *
 * The grammar is simple recursive descent:
 *   expression = orExpr
 *   orExpr     = andExpr ( "OR" andExpr )*
 *   andExpr    = primary ( "AND" primary )*
 *   primary    = "(" expression ")" | licenseId
 */

const ALLOWED_LICENSES = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "CC0-1.0",
  "BlueOak-1.0.0",
]);

/**
 * Tokenize an SPDX expression into identifiers and operators.
 *
 * @param {string} expr
 * @returns {string[]} tokens
 */
function tokenize(expr) {
  if (typeof expr !== "string") return [];
  const tokens = [];
  // Match parentheses, OR, AND, and license identifiers (including dashes, dots, and digits)
  const re = /\(|\)|\bOR\b|\bAND\b|[A-Za-z0-9][A-Za-z0-9.\-]*/g;
  let match;
  while ((match = re.exec(expr)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

/**
 * Parse and evaluate an SPDX expression against the allowlist.
 *
 * @param {string} expr - The SPDX expression to evaluate.
 * @param {Set<string>} [allowed] - Set of allowed license identifiers. Defaults to ALLOWED_LICENSES.
 * @returns {boolean} true if the expression is satisfied by the allowlist.
 */
function evaluateSpdxExpression(expr, allowed = ALLOWED_LICENSES) {
  if (!expr || typeof expr !== "string") return false;
  const trimmed = expr.trim();
  if (!trimmed) return false;

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return false;

  let pos = 0;

  function peek() {
    return tokens[pos];
  }

  function consume() {
    return tokens[pos++];
  }

  function parsePrimary() {
    const tok = peek();
    if (tok === "(") {
      consume(); // consume "("
      const result = parseOr();
      if (peek() === ")") consume(); // consume ")"
      return result;
    }
    // License identifier
    const id = consume();
    if (!id) return false;
    // Skip "OR" and "AND" — they're operators, not license IDs
    if (id === "OR" || id === "AND") return false;
    return allowed.has(id);
  }

  function parseAnd() {
    let result = parsePrimary();
    while (peek() === "AND") {
      consume();
      const rhs = parsePrimary();
      result = result && rhs;
    }
    return result;
  }

  function parseOr() {
    let result = parseAnd();
    while (peek() === "OR") {
      consume();
      const rhs = parseAnd();
      result = result || rhs;
    }
    return result;
  }

  try {
    const result = parseOr();
    // If there are leftover tokens, the expression was malformed
    if (pos < tokens.length) return false;
    return result;
  } catch (_) {
    return false;
  }
}

module.exports = {
  evaluateSpdxExpression,
  ALLOWED_LICENSES,
};
