// Redact seed-shaped tokens, including URL-encoded request paths.
function redactSeeds(value) {
  if (typeof value === "string") {
    let decoded = value;
    try { decoded = decodeURIComponent(value); } catch (_) { /* malformed URL */ }
    return decoded.replace(/S[A-Z2-7]{55}/g, "[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redactSeeds);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSeeds(item)]));
  }
  return value;
}
module.exports = redactSeeds;
