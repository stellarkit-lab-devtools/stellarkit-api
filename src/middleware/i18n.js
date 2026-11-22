/**
 * Internationalization (i18n) middleware.
 * 
 * Detects client language preference from Accept-Language header,
 * selects appropriate locale with q-value parsing.
 * 
 * Supported locales: en (default), es, fr
 * 
 * Sets:
 *   - req.i18n.locale: Selected locale code
 *   - req.i18n.t(key): Translation function for error messages
 *   - res.set('Content-Language', locale): Response header
 */

const path = require('path');

const SUPPORTED_LOCALES = new Set(['en', 'es', 'fr']);
const DEFAULT_LOCALE = 'en';
const MAX_CATALOG_CACHE = 100;

// In-memory locale catalogs (lazy-loaded)
const catalogCache = new Map();

/**
 * Load and cache a locale catalog.
 * @param {string} locale - Locale code
 * @returns {Object} Catalog object
 */
function loadCatalog(locale) {
  if (catalogCache.has(locale)) {
    return catalogCache.get(locale);
  }

  try {
    const catalog = require(path.join(__dirname, '..', 'i18n', `${locale}.json`));
    
    // Prevent unbounded cache growth
    if (catalogCache.size >= MAX_CATALOG_CACHE) {
      catalogCache.clear();
    }
    catalogCache.set(locale, catalog);
    
    return catalog;
  } catch (err) {
    return null;
  }
}

/**
 * Parse Accept-Language header with q-values.
 * Returns array of locale codes sorted by q-value (descending).
 * 
 * @param {string} acceptLanguage - Accept-Language header value
 * @returns {string[]} Sorted locale codes
 */
function parseAcceptLanguage(acceptLanguage) {
  if (!acceptLanguage || typeof acceptLanguage !== 'string') {
    return [DEFAULT_LOCALE];
  }

  const locales = [];

  for (const part of acceptLanguage.split(',')) {
    const trimmed = part.trim();
    const segments = trimmed.split(';');
    
    const localeCode = segments[0].trim().toLowerCase();
    let q = 1.0;

    for (const seg of segments.slice(1)) {
      const kv = seg.trim().split('=');
      if (kv[0].trim().toLowerCase() === 'q' && kv[1]) {
        const parsed = parseFloat(kv[1]);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          q = parsed;
        }
      }
    }

    locales.push({ code: localeCode, q });
  }

  // Sort by q-value descending, then by position in header
  locales.sort((a, b) => b.q - a.q);

  return locales.map(l => l.code);
}

/**
 * Select best matching locale from supported locales.
 * Falls back to English for unsupported languages.
 * 
 * @param {string[]} parsedLocales - Array of locale codes from Accept-Language
 * @returns {string} Selected locale code
 */
function selectLocale(parsedLocales) {
  for (const locale of parsedLocales) {
    // Match exact or primary language (e.g., "fr-FR" -> "fr")
    const primary = locale.split('-')[0];
    if (SUPPORTED_LOCALES.has(locale)) {
      return locale;
    }
    if (SUPPORTED_LOCALES.has(primary)) {
      return primary;
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * Escape interpolated values for safe output.
 * Escapes <, >, &, " and ' to prevent XSS in error messages.
 * 
 * @param {any} value - Value to escape
 * @returns {string} Escaped string
 */
function escapeInterpolated(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Create translation function for a locale.
 * 
 * @param {Object} catalog - Locale catalog
 * @returns {Function} Translation function
 */
function createTranslator(catalog) {
  return function translate(key, interpolate = {}) {
    const entry = catalog && catalog[key];
    
    if (!entry) {
      // Fallback to English if key missing in current locale
      const fallbackCatalog = loadCatalog(DEFAULT_LOCALE);
      const fallbackEntry = fallbackCatalog && fallbackCatalog[key];
      
      if (!fallbackEntry) {
        return key; // Return key as last resort
      }
      
      let message = fallbackEntry.message || key;
      let suggestion = fallbackEntry.suggestion;
      
      // Interpolate values
      for (const [k, v] of Object.entries(interpolate)) {
        const escaped = escapeInterpolated(v);
        message = message.replace(new RegExp(`\\{${k}\\}`, 'g'), escaped);
        if (suggestion) {
          suggestion = suggestion.replace(new RegExp(`\\{${k}\\}`, 'g'), escaped);
        }
      }
      
      return { message, suggestion, type: key };
    }

    let message = entry.message || key;
    let suggestion = entry.suggestion;

    // Interpolate values
    for (const [k, v] of Object.entries(interpolate)) {
      const escaped = escapeInterpolated(v);
      message = message.replace(new RegExp(`\\{${k}\\}`, 'g'), escaped);
      if (suggestion) {
        suggestion = suggestion.replace(new RegExp(`\\{${k}\\}`, 'g'), escaped);
      }
    }

    return { message, suggestion, type: key };
  };
}

/**
 * i18n middleware factory.
 * Attaches locale detection and translation function to req.i18n.
 */
function i18nMiddleware(req, res, next) {
  const acceptLanguage = req.headers['accept-language'];
  const parsedLocales = parseAcceptLanguage(acceptLanguage);
  const locale = selectLocale(parsedLocales);

  // Load catalog for selected locale
  const catalog = loadCatalog(locale) || loadCatalog(DEFAULT_LOCALE);

  // Attach to request
  req.i18n = {
    locale,
    t: createTranslator(catalog),
    translate: createTranslator(catalog),
  };

  // Set Content-Language header on response
  res.set('Content-Language', locale);

  next();
}

module.exports = i18nMiddleware;
module.exports.parseAcceptLanguage = parseAcceptLanguage;
module.exports.selectLocale = selectLocale;
module.exports.escapeInterpolated = escapeInterpolated;
module.exports.SUPPORTED_LOCALES = SUPPORTED_LOCALES;
module.exports.DEFAULT_LOCALE = DEFAULT_LOCALE;