/**
 * Recurring Payments Detection
 * 
 * Detects recurring payments (rent, salaries, subscriptions) by analyzing
 * payment operations and grouping them by counterparty, asset, and amount.
 * 
 * Path: GET /account/:id/recurring-payments
 * 
 * Query Parameters:
 *   - days: Number of days to scan (default: 180, max: 365)
 *   - direction: 'outbound' | 'inbound' (default: 'outbound')
 *   - minOccurrences: Minimum occurrences to qualify (default: 3)
 * 
 * Response includes cadence detection with status (active/lapsed).
 * Path payments are excluded.
 */

const express = require("express");
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAccountId } = require("../utils/validators");

const router = express.Router();

const DEFAULT_DAYS = 180;
const MAX_DAYS = 365;
const MAX_PAYMENTS = 2000;
const DEFAULT_MIN_OCCURRENCES = 3;
const CV_THRESHOLD = 0.25;

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function coefficientOfVariation(arr) {
  if (arr.length < 2) return 1;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  if (mean === 0) return 1;
  const squaredDiffs = arr.map(x => Math.pow(x - mean, 2));
  const stdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / arr.length);
  return stdDev / mean;
}

function determineCadence(medianIntervalDays) {
  const tolerance = 0.2;
  const daily = 1, weekly = 7, biweekly = 14, monthly = 30;
  if (Math.abs(medianIntervalDays - daily) / daily <= tolerance) return "daily";
  if (Math.abs(medianIntervalDays - weekly) / weekly <= tolerance) return "weekly";
  if (Math.abs(medianIntervalDays - biweekly) / biweekly <= tolerance) return "biweekly";
  if (Math.abs(medianIntervalDays - monthly) / monthly <= tolerance) return "monthly";
  return "custom";
}

async function fetchPayments(accountId, direction, startTime, limit) {
  const payments = server.payments()
    .forAccount(accountId)
    .order("desc")
    .limit(limit);
  
  const response = await payments.call();
  return response.records.filter(p => {
    const isPayment = p.type === "payment" || p.type === "create_account";
    if (!isPayment) return false;
    const txTime = new Date(p.created_at).getTime();
    if (txTime < startTime) return false;
    if (direction === "outbound" && p.source_account === accountId) return true;
    if (direction === "inbound" && p.to === accountId) return true;
    return false;
  });
}

function groupPayments(payments, direction) {
  const groups = new Map();
  
  for (const p of payments) {
    const counterparty = direction === "outbound" ? p.to : p.from;
    const asset = p.asset_type === "native" ? "XLM" : `${p.asset_code}:${p.asset_issuer}`;
    const amount = p.amount;
    const key = `${counterparty}:${asset}:${amount}`;
    
    if (!groups.has(key)) {
      groups.set(key, { counterparty, asset, amount, timestamps: [] });
    }
    groups.get(key).timestamps.push(new Date(p.created_at).getTime());
  }
  
  return Array.from(groups.values());
}

function analyzeGroup(group, minOccurrences) {
  const { timestamps, amount } = group;
  
  if (timestamps.length < minOccurrences) return null;
  
  timestamps.sort((a, b) => a - b);
  
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push((timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60 * 24));
  }
  
  if (coefficientOfVariation(intervals) > CV_THRESHOLD) return null;
  
  const medianInterval = median(intervals);
  const cadence = determineCadence(medianInterval);
  
  const now = Date.now();
  const lastAt = new Date(Math.max(...timestamps)).toISOString();
  const firstAt = new Date(Math.min(...timestamps)).toISOString();
  const nextExpectedAt = new Date(Math.max(...timestamps) + medianInterval * 24 * 60 * 60 * 1000).toISOString();
  
  const lapsedThreshold = medianInterval * 2 * 24 * 60 * 60 * 1000;
  const status = now > new Date(lastAt).getTime() + lapsedThreshold ? "lapsed" : "active";
  
  return {
    counterparty: group.counterparty,
    asset: group.asset,
    amount: parseFloat(amount).toFixed(7),
    occurrences: timestamps.length,
    medianIntervalDays: Math.round(medianInterval * 1000) / 1000,
    cadence,
    firstAt,
    lastAt,
    nextExpectedAt,
    status
  };
}

router.get("/:id/recurring-payments", async (req, res, next) => {
  try {
    const { id } = req.params;
    const days = Math.min(Math.max(1, parseInt(req.query.days) || DEFAULT_DAYS), MAX_DAYS);
    const direction = req.query.direction || "outbound";
    const minOccurrences = Math.max(1, parseInt(req.query.minOccurrences) || DEFAULT_MIN_OCCURRENCES);
    
    validateAccountId(id);
    
    const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const payments = await fetchPayments(id, direction, startTime, MAX_PAYMENTS);
    
    const groups = groupPayments(payments, direction);
    const recurring = groups.map(g => analyzeGroup(g, minOccurrences)).filter(Boolean);
    recurring.sort((a, b) => b.occurrences - a.occurrences);
    
    const partial = payments.length >= MAX_PAYMENTS;
    
    success(res, {
      items: recurring,
      total: recurring.length,
      meta: { scannedDays: days, direction, minOccurrences, scannedPayments: payments.length, partial, note: "Path payments are excluded" }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;