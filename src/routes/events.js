const express = require("express");
const { server } = require("../config/stellar");
const cacheService = require("../services/cache");
const { success } = require("../utils/response");
const cacheTTL = require("../config/cacheConfig");

const router = express.Router();

// Default and max values
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000; // 5 pages of 1000
const PAGE_SIZE = 1000;
const CACHE_TTL_SECONDS = 15;

// Diagnostic event topics (to be excluded by default)
const DIAGNOSTIC_TOPICS = [
  "diagnostic",
  "diagnostic_event",
  "system",
];

/**
 * Decode the first topic of an event to a native value.
 * Soroban events have topics as an array of values (SCVal).
 */
function decodeTopicValue(topic) {
  if (!topic || !topic[0]) return null;
  
  const firstTopic = topic[0];
  
  // Handle different value types
  if (firstTopic.type === "symbol") {
    return firstTopic.value;
  }
  if (firstTopic.type === "string") {
    return firstTopic.value;
  }
  if (firstTopic.type === "address") {
    return firstTopic.value;
  }
  if (firstTopic.type === "u64" || firstTopic.type === "i64") {
    return firstTopic.value;
  }
  if (firstTopic.type === "u32" || firstTopic.type === "i32") {
    return firstTopic.value;
  }
  
  // Try to return as string representation
  return String(firstTopic.value || firstTopic);
}

/**
 * Check if an event is diagnostic based on its topics
 */
function isDiagnosticEvent(topics) {
  if (!topics || !topics[0]) return false;
  const decoded = decodeTopicValue(topics);
  if (typeof decoded === "string") {
    const lower = decoded.toLowerCase();
    return DIAGNOSTIC_TOPICS.some(t => lower.includes(t));
  }
  return false;
}

/**
 * Validate contract ID format
 */
function isValidContractId(contractId) {
  if (!contractId || typeof contractId !== "string") return false;
  // Contract IDs are 56 characters (hex encoded, starts with C)
  return /^C[A-Z0-9]{55}$/.test(contractId);
}

/**
 * Get events for a contract with pagination, counting, and topic analysis
 */
async function getContractEvents(contractId, options = {}) {
  const {
    fromLedger,
    toLedger,
    limit = DEFAULT_LIMIT,
    includeDiagnostic = false,
  } = options;

  const events = [];
  let currentFromLedger = fromLedger;
  let totalFetched = 0;
  let hasMore = true;
  
  // Fetch up to 5 pages of 1000 events each
  const maxPages = 5;
  
  for (let page = 0; page < maxPages && hasMore; page++) {
    const fetchLimit = Math.min(PAGE_SIZE, limit - totalFetched);
    
    if (fetchLimit <= 0) break;
    
    const cursor = page === 0 ? undefined : (events[events.length - 1]?.pagingToken);
    
    try {
      const result = await server.getEvents({
        startLedger: currentFromLedger,
        endLedger: toLedger,
        limit: fetchLimit,
        cursor,
      });
      
      if (!result.events || result.events.length === 0) {
        hasMore = false;
        break;
      }
      
      for (const event of result.events) {
        // Skip diagnostic events unless explicitly included
        if (!includeDiagnostic && isDiagnosticEvent(event.topic)) {
          continue;
        }
        
        events.push(event);
        totalFetched++;
        
        if (totalFetched >= limit) {
          hasMore = false;
          break;
        }
      }
      
      if (!result.pagingToken || result.events.length < fetchLimit) {
        hasMore = false;
      }
    } catch (error) {
      // If we get an error, stop fetching
      hasMore = false;
      if (events.length === 0) {
        throw error;
      }
    }
  }

  return events;
}

/**
 * Analyze events to produce counting and topic aggregation
 */
function analyzeEvents(events) {
  const byType = {};
  const topicCounts = {};
  let totalEvents = 0;

  for (const event of events) {
    totalEvents++;
    
    // Count by type
    const type = event.type || "unknown";
    byType[type] = (byType[type] || 0) + 1;
    
    // Count topics
    const decodedTopic = decodeTopicValue(event.topic);
    if (decodedTopic) {
      const topicKey = String(decodedTopic);
      topicCounts[topicKey] = (topicCounts[topicKey] || 0) + 1;
    }
  }

  // Format topics as array with count
  const topics = Object.entries(topicCounts)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count);

  return { byType, topics, totalEvents };
}

// GET /events?contractId=xxx&ledgers=1000&includeDiagnostic=true
router.get("/", async (req, res, next) => {
  try {
    const { contractId, ledgers, includeDiagnostic } = req.query;

    // Validate contract ID
    if (!contractId) {
      return res.status(400).json({
        success: false,
        error: {
          type: "BadRequest",
          message: "contractId query parameter is required",
        },
      });
    }

    if (!isValidContractId(contractId)) {
      return res.status(400).json({
        success: false,
        error: {
          type: "BadRequest",
          message: "Invalid contractId format. Expected a valid Soroban contract ID (e.g., CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABG4)",
        },
      });
    }

    // Parse ledgers parameter (default 1000)
    let lookback = DEFAULT_LIMIT;
    if (ledgers !== undefined) {
      const parsed = parseInt(ledgers, 10);
      if (isNaN(parsed) || parsed <= 0) {
        return res.status(400).json({
          success: false,
          error: {
            type: "BadRequest",
            message: "ledgers must be a positive integer",
          },
        });
      }
      lookback = parsed;
    }

    // Clamp to max
    lookback = Math.min(lookback, MAX_LIMIT);

    // Get the oldest ledger the RPC retains
    let oldestLedger;
    try {
      const ledgerInfo = await server.ledgers().order("asc").limit(1).call();
      if (ledgerInfo.records && ledgerInfo.records.length > 0) {
        oldestLedger = ledgerInfo.records[0].sequence;
      }
    } catch (err) {
      // Fallback: use current ledger - lookback
      const info = await server.loadBaseAccount(server.getPublicKey());
      oldestLedger = info.lastModifiedSequence - 10000; // Rough estimate
    }

    // Get current ledger
    const currentLedger = (await server.ledgers().order("desc").limit(1).call())
      .records[0].sequence;

    // Clamp the lookback to what the RPC retains
    const actualFromLedger = Math.max(
      currentLedger - lookback,
      oldestLedger || (currentLedger - 10000)
    );

    // Build cache key
    const cacheKey = `events:${contractId}:${actualFromLedger}:${currentLedger}:${lookback}:${includeDiagnostic === "true"}`;
    
    // Check cache first
    const cached = cacheService.get(cacheKey);
    if (cached) {
      return success(res, {
        ...cached,
        cached: true,
      });
    }

    // Fetch events
    const events = await getContractEvents(contractId, {
      fromLedger: actualFromLedger,
      toLedger: currentLedger,
      limit: lookback,
      includeDiagnostic: includeDiagnostic === "true",
    });

    // Analyze events
    const { byType, topics, totalEvents } = analyzeEvents(events);

    // Determine if result is partial (didn't get all events in range)
    const isPartial = events.length >= lookback;

    const result = {
      contractId,
      fromLedger: actualFromLedger,
      toLedger: currentLedger,
      totalEvents,
      byType,
      topics: topics.slice(0, 100), // Limit to top 100 topics
      partial: isPartial,
    };

    // Cache for 15 seconds
    cacheService.set(cacheKey, result, CACHE_TTL_SECONDS);

    return success(res, result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;