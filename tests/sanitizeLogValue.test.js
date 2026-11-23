/**
 * Tests for sanitizeLogValue utility.
 * 
 * Coverage:
 * - Newline in user agent
 * - ANSI escape in path
 * - Oversized value truncation
 * - Normal values unchanged
 * - Each log entry stays on one line
 */

const {
  sanitizeLogValue,
  sanitizeLogFields,
  MAX_LOG_VALUE_LENGTH,
} = require('../src/utils/sanitizeLogValue');

describe('sanitizeLogValue', () => {
  describe('control character escaping', () => {
    test('escapes newline (LF)', () => {
      expect(sanitizeLogValue('hello\nworld')).toBe('hello\\nworld');
    });

    test('escapes carriage return (CR)', () => {
      expect(sanitizeLogValue('hello\rworld')).toBe('hello\\rworld');
    });

    test('escapes tab', () => {
      expect(sanitizeLogValue('hello\tworld')).toBe('hello\\tworld');
    });

    test('escapes other C0 controls', () => {
      expect(sanitizeLogValue('hello\x00world')).toBe('hello\\x00world');
      expect(sanitizeLogValue('hello\x1fworld')).toBe('hello\\x1fworld');
    });

    test('escapes DEL character', () => {
      expect(sanitizeLogValue('hello\x7fworld')).toBe('hello\\x7fworld');
    });
  });

  describe('ANSI escape sequences', () => {
    test('escapes ANSI escape in path', () => {
      // Simulate an ANSI escape sequence in the path
      const pathWithAnsi = '/api/\x1b[31mtest\x1b[0m';
      const result = sanitizeLogValue(pathWithAnsi);
      expect(result).toContain('\\x1b');
      expect(result).not.toContain('\x1b');
    });

    test('escapes ANSI color codes', () => {
      const colored = '\x1b[32mgreen\x1b[0m text';
      expect(sanitizeLogValue(colored)).toBe('\\x1b[32mgreen\\x1b[0m text');
    });

    test('escapes ANSI cursor movement', () => {
      const cursor = '\x1b[10;10Hmove';
      expect(sanitizeLogValue(cursor)).toBe('\\x1b[10;10Hmove');
    });
  });

  describe('Unicode line terminators', () => {
    test('escapes U+2028 (Line Separator)', () => {
      expect(sanitizeLogValue('hello\u2028world')).toBe('hello\\u2028world');
    });

    test('escapes U+2029 (Paragraph Separator)', () => {
      expect(sanitizeLogValue('hello\u2029world')).toBe('hello\\u2029world');
    });
  });

  describe('truncation', () => {
    test('truncates oversized value with ellipsis', () => {
      const longValue = 'a'.repeat(300);
      const result = sanitizeLogValue(longValue);
      expect(result.length).toBe(MAX_LOG_VALUE_LENGTH);
      expect(result.endsWith('...')).toBe(true);
    });

    test('does not truncate values at exactly MAX_LOG_VALUE_LENGTH', () => {
      const exactValue = 'a'.repeat(MAX_LOG_VALUE_LENGTH);
      const result = sanitizeLogValue(exactValue);
      expect(result.length).toBe(MAX_LOG_VALUE_LENGTH);
      expect(result.endsWith('...')).toBe(false);
    });

    test('truncates after escaping (value grows when escaping)', () => {
      // Value with many newlines - escaping adds characters
      const valueWithNewlines = 'a\n'.repeat(150);
      const result = sanitizeLogValue(valueWithNewlines);
      expect(result.length).toBeLessThanOrEqual(MAX_LOG_VALUE_LENGTH);
    });
  });

  describe('normal values', () => {
    test('leaves normal strings unchanged', () => {
      expect(sanitizeLogValue('hello world')).toBe('hello world');
    });

    test('handles numbers', () => {
      expect(sanitizeLogValue(12345)).toBe('12345');
    });

    test('handles null', () => {
      expect(sanitizeLogValue(null)).toBe('');
    });

    test('handles undefined', () => {
      expect(sanitizeLogValue(undefined)).toBe('');
    });

    test('handles empty string', () => {
      expect(sanitizeLogValue('')).toBe('');
    });
  });

  describe('log entry on one line', () => {
    test('newline in user agent stays on one line', () => {
      const userAgent = 'Mozilla/5.0\nMalicious-Client';
      const result = sanitizeLogValue(userAgent);
      expect(result.includes('\n')).toBe(false);
      expect(result.includes('\\n')).toBe(true);
    });

    test('multiple newlines become escaped', () => {
      const value = 'line1\nline2\nline3';
      const result = sanitizeLogValue(value);
      // Should have escaped newlines, not actual ones
      expect(result.split('\n').length).toBe(1);
      expect(result.match(/\\n/g) || []).length >= 2;
    });

    test('ANSI + newline combination stays on one line', () => {
      const value = '/path\x1b[31m\n\x1b[0m';
      const result = sanitizeLogValue(value);
      expect(result.includes('\n')).toBe(false);
      expect(result.includes('\\n')).toBe(true);
      expect(result.includes('\\x1b')).toBe(true);
    });
  });

  describe('sanitizeLogFields', () => {
    test('sanitizes multiple fields', () => {
      const fields = {
        path: '/api/test\nmalicious',
        query: 'foo=bar',
        userAgent: 'Mozilla/5.0',
      };
      const result = sanitizeLogFields(fields, ['path']);
      expect(result.path).toBe('/api/test\\nmalicious');
      expect(result.query).toBe('foo=bar'); // unchanged
    });

    test('handles missing fields gracefully', () => {
      const fields = { path: '/test' };
      const result = sanitizeLogFields(fields, ['nonexistent']);
      expect(result.nonexistent).toBeUndefined();
    });

    test('does not modify original object', () => {
      const fields = { path: '/test\nbad' };
      const result = sanitizeLogFields(fields, ['path']);
      expect(fields.path).toBe('/test\nbad'); // original unchanged
      expect(result.path).toBe('/test\\nbad'); // new object sanitized
    });
  });
});