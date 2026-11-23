/**
 * UTC-safe date parsing helpers.
 *
 * JavaScript's Date constructor parses an ISO 8601 date-time without a zone
 * designator (e.g. "2024-01-15T12:00:00") in the server's *local* time zone,
 * and parses non-ISO strings (e.g. "Jan 15 2024") in local time as well. The
 * same query parameter would then select different records on servers in
 * different time zones. Everything in this API is UTC, so parse through here.
 */

// YYYY-MM-DD, optionally followed by THH:mm[:ss[.sss]] and a zone (Z or ±HH[:]mm).
const ISO_8601_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?([Zz]|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Parses an ISO 8601 date or date-time string as UTC.
 *
 * - "2024-01-15"                → 2024-01-15T00:00:00.000Z
 * - "2024-01-15T12:00:00"       → 2024-01-15T12:00:00.000Z (no zone ⇒ UTC, not local)
 * - "2024-01-15T12:00:00+02:00" → 2024-01-15T10:00:00.000Z (explicit offset honoured)
 *
 * Strings that are not ISO 8601 return an invalid Date rather than being
 * parsed in the server's local zone.
 *
 * @param {string} value
 * @returns {Date} The parsed Date (check with isNaN(date.getTime())).
 */
function parseUTCDate(value) {
  if (typeof value !== "string") return new Date(NaN);
  const trimmed = value.trim();
  const match = ISO_8601_PATTERN.exec(trimmed);
  if (!match) return new Date(NaN);

  const hasTime = match[4] !== undefined;
  const hasZone = match[7] !== undefined;

  // A zone without a time ("2024-01-15Z") is not valid ISO 8601.
  if (!hasTime && hasZone) return new Date(NaN);

  let normalised = trimmed.replace(" ", "T");
  if (hasTime && !hasZone) normalised += "Z";

  const date = new Date(normalised);
  if (isNaN(date.getTime())) return date;

  // Reject calendar overflow such as "2024-02-30", which Date would roll over.
  if (!hasZone) {
    const [, y, m, d] = match;
    if (
      date.getUTCFullYear() !== Number(y) ||
      date.getUTCMonth() + 1 !== Number(m) ||
      date.getUTCDate() !== Number(d)
    ) {
      return new Date(NaN);
    }
  }

  return date;
}

/**
 * Converts a timestamp (Date, epoch milliseconds or ISO 8601 string) to epoch
 * milliseconds, parsing strings as UTC. Returns NaN when it cannot be parsed.
 *
 * @param {Date|number|string} value
 * @returns {number}
 */
function toUTCMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return parseUTCDate(value).getTime();
}

module.exports = { parseUTCDate, toUTCMillis, ISO_8601_PATTERN };
