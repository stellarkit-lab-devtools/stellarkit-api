/**
 * Formats a raw Stellar balance string into a human-friendly display string
 * with thousand separators (commas).
 *
 * @param {string} balance - The raw balance string (e.g., "10000.1234567")
 * @returns {string} The formatted balance string with thousand separators (e.g., "10,000.1234567")
 *
 * @example
 * formatBalance("10000.1234567") // "10,000.1234567"
 * formatBalance("0.0000100") // "0.0000100"
 * formatBalance("1234567.89") // "1,234,567.89"
 * formatBalance("100") // "100"
 */
function formatBalance(balance) {
  if (!balance || typeof balance !== "string") {
    return balance;
  }

  // Split the balance into integer and decimal parts
  const parts = balance.split(".");

  // Add thousand separators to the integer part
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // Reconstruct: if there's a decimal part, add it back; otherwise just return the integer part
  if (parts.length > 1) {
    return integerPart + "." + parts[1];
  }

  return integerPart;
}

module.exports = { formatBalance };
