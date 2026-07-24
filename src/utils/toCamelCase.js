/**
 * Recursively converts all snake_case keys in an object to camelCase.
 */
function toCamelCase(obj) {
  if (Array.isArray(obj)) {
    return obj.map(toCamelCase);
  }

  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        toCamelCase(value),
      ]),
    );
  }

  return obj;
}

module.exports = { toCamelCase };
