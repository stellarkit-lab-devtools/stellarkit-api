/**
 * Account age and longevity calculation utilities.
 * Pure functions — no I/O, no SDK calls, no side effects.
 */

// Maturity thresholds (in days)
const MATURITY_NEW_THRESHOLD_DAYS = 30;
const MATURITY_ESTABLISHED_THRESHOLD_DAYS = 365;

// Average days per month and year for accurate calculation
const AVG_DAYS_PER_MONTH = 30.4375; // 365.25 / 12
const AVG_DAYS_PER_YEAR = 365.25;

/**
 * Calculates the number of complete days between a past date and now.
 * Uses Math.floor — never rounds up (an account is not "1 day old"
 * until a full 24 hours have passed since creation).
 *
 * @param {string} createdAt - ISO 8601 creation timestamp
 * @param {Date} [now] - Current timestamp (injectable for testing)
 * @returns {number} Integer number of complete days elapsed
 */
function calculateAgeInDays(createdAt, now) {
  const currentTime = now || new Date();
  const createdTime = new Date(createdAt);
  const millisPerDay = 24 * 60 * 60 * 1000;
  const daysDiff = (currentTime - createdTime) / millisPerDay;
  return Math.floor(daysDiff);
}

/**
 * Converts days to complete months (floor division by AVG_DAYS_PER_MONTH).
 *
 * @param {number} days - Number of days
 * @returns {number} Number of complete months (floored)
 */
function daysToMonths(days) {
  return Math.floor(days / AVG_DAYS_PER_MONTH);
}

/**
 * Converts days to complete years (floor division by AVG_DAYS_PER_YEAR).
 *
 * @param {number} days - Number of days
 * @returns {number} Number of complete years (floored)
 */
function daysToYears(days) {
  return Math.floor(days / AVG_DAYS_PER_YEAR);
}

/**
 * Determines maturity label based on age in days.
 * - 'new':         ageInDays < 30
 * - 'established': 30 <= ageInDays < 365
 * - 'veteran':     ageInDays >= 365
 *
 * @param {number} ageInDays - Age in days
 * @returns {'new' | 'established' | 'veteran'} Maturity label
 */
function getMaturityLabel(ageInDays) {
  if (ageInDays < MATURITY_NEW_THRESHOLD_DAYS) {
    return "new";
  }
  if (ageInDays < MATURITY_ESTABLISHED_THRESHOLD_DAYS) {
    return "established";
  }
  return "veteran";
}

/**
 * Composes all age metrics into the full AccountAgeResponse shape.
 * All computation happens here — controller just calls this.
 *
 * @param {Object} params - Parameters object
 * @param {string} params.publicKey - The account public key
 * @param {number} params.createdAtLedger - Ledger sequence number of first funding tx
 * @param {string} params.createdAt - ISO 8601 timestamp of account creation
 * @param {Date} [params.now] - Current timestamp (injectable for deterministic tests)
 * @returns {Object} AccountAgeResponse object
 */
function buildAccountAgeResponse({
  publicKey,
  createdAtLedger,
  createdAt,
  now,
}) {
  const ageInDays = calculateAgeInDays(createdAt, now);
  const ageInMonths = daysToMonths(ageInDays);
  const ageInYears = daysToYears(ageInDays);
  const maturity = getMaturityLabel(ageInDays);

  return {
    publicKey,
    createdAtLedger,
    createdAt,
    ageInDays,
    ageInMonths,
    ageInYears,
    maturity,
  };
}

module.exports = {
  calculateAgeInDays,
  daysToMonths,
  daysToYears,
  getMaturityLabel,
  buildAccountAgeResponse,
  // Export constants for testing and reference
  MATURITY_NEW_THRESHOLD_DAYS,
  MATURITY_ESTABLISHED_THRESHOLD_DAYS,
  AVG_DAYS_PER_MONTH,
  AVG_DAYS_PER_YEAR,
};
