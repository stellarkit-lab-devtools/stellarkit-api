/**
 * Log Value Sanitization Utility
 * 
 * Escapes control characters and special Unicode sequences that can:
 * - Forge log lines in plain output (newlines)
 * - Hijack terminal in pretty-print mode (ANSI escapes)
 * 
 * Applied to: path, query string, User-Agent, Referer, Origin,
 * and any user-supplied value in error logs.
 */

const MAX_LOG_VALUE_LENGTH = 200;

// Control character ranges (C0 and DEL)
const C0_CONTROL = /[\x00-\x1f\x7f]/g;

// Visible escape sequences for control characters
const CONTROL_ESCAPES = {
  '\x00': '\\x00',
  '\x01': '\\x01',
  '\x02': '\\x02',
  '\x03': '\\x03',
  '\x04': '\\x04',
  '\x05': '\\x05',
  '\x06': '\\x06',
  '\x07': '\\x07',
  '\x08': '\\x08',
  '\x09': '\\t',
  '\x0a': '\\n',
  '\x0b': '\\v',
  '\x0c': '\\f',
  '\x0d': '\\r',
  '\x0e': '\\x0e',
  '\x0f': '\\x0f',
  '\x10': '\\x10',
  '\x11': '\\x11',
  '\x12': '\\x12',
  '\x13': '\\x13',
  '\x14': '\\x14',
  '\x15': '\\x15',
  '\x16': '\\x16',
  '\x17': '\\x17',
  '\x18': '\\x18',
  '\x19': '\\x19',
  '\x1a': '\\x1a',
  '\x1b': '\\x1b',
  '\x1c': '\\x1c',
  '\x1d': '\\x1d',
  '\x1e': '\\x1e',
  '\x1f': '\\x1f',
  '\x7f': '\\x7f',
};

// Unicode line terminators that aren't \n or \r
const UNICODE_LINE_TERMINATORS = /\u2028|\u2029/g;

// ANSI escape sequence pattern
const ANSI_ESCAPE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Escape a single control character to its visible representation.
 * @param {string} char - Single character
 * @returns {string} Escaped representation
 */
function escapeControlChar(char) {
  return CONTROL_ESCAPES[char] || char;
}

/**
 * Sanitize a value for safe logging.
 * - Escapes CR, LF, C0 controls, and DEL
 * - Escapes U+2028 (Line Separator) and U+2029 (Paragraph Separator)
 * - Converts ANSI escapes to visible \x1b sequence
 * - Truncates to MAX_LOG_VALUE_LENGTH with ellipsis
 * 
 * @param {any} value - Value to sanitize
 * @returns {string} Sanitized string (always returns a string)
 */
function sanitizeLogValue(value) {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return '';
  }

  // Convert to string
  let str = String(value);

  // Already short enough - still need to check for invisible escapes
  if (str.length <= MAX_LOG_VALUE_LENGTH) {
    // First escape ANSI sequences (so \x1b in ANSI codes is protected)
    // This must happen BEFORE C0 control replacement since \x1b is in C0 range
    str = str.replace(ANSI_ESCAPE, (match) => {
      return match.replace(/\x1b/g, '\\x1b');
    });

    // Escape C0 controls and DEL (now \x1b not in input, only \\x1b from above)
    str = str.replace(C0_CONTROL, escapeControlChar);

    // Escape Unicode line terminators
    str = str.replace(UNICODE_LINE_TERMINATORS, (match) => {
      if (match === '\u2028') return '\\u2028';
      return '\\u2029';
    });

    return str;
  }

  // Long value - truncate first, then sanitize
  // Truncate to leave room for ellipsis and escape sequences
  const targetLength = MAX_LOG_VALUE_LENGTH - 3;
  str = str.substring(0, targetLength);

  // Apply same escaping as above (ANSI first, then C0)
  str = str.replace(ANSI_ESCAPE, (match) => {
    return match.replace(/\x1b/g, '\\x1b');
  });
  str = str.replace(C0_CONTROL, escapeControlChar);
  str = str.replace(UNICODE_LINE_TERMINATORS, (match) => {
    if (match === '\u2028') return '\\u2028';
    return '\\u2029';
  });

  return str + '...';
}

/**
 * Sanitize multiple log fields at once.
 * 
 * @param {Object} fields - Object with log fields
 * @param {string[]} fieldNames - Array of field names to sanitize
 * @returns {Object} New object with sanitized values
 */
function sanitizeLogFields(fields, fieldNames) {
  const result = { ...fields };
  
  for (const field of fieldNames) {
    if (field in result) {
      result[field] = sanitizeLogValue(result[field]);
    }
  }
  
  return result;
}

module.exports = sanitizeLogValue;
module.exports.sanitizeLogFields = sanitizeLogFields;
module.exports.MAX_LOG_VALUE_LENGTH = MAX_LOG_VALUE_LENGTH;