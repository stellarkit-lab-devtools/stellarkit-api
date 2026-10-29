'use strict';

const request = require('supertest');
const app = require('../../app');
const db = require('../../db');

const ASSET_CODE = 'OHLCV';
const ASSET_ISSUER = 'GOHLCVISSUERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Controlled trade history: 5 trades all within a single hour.
// Base timestamp aligned to the start of an hour to keep candle boundaries predictable.
const BASE_TIME = Date.UTC(2024, 0, 1, 12, 0, 0); // 2024-01-01T12:00:00Z

const TRADES = [
  { time: BASE_TIME + 1 * 60 * 1000, price: 10, amount: 100 }, // open
  { time: BASE_TIME + 5 * 60 * 1000, price: 15, amount: 50 }, // high
  { time: BASE_TIME + 10 * 60 * 1000, price: 5, amount: 200 }, // low
  { time: BASE_TIME + 20 * 60 * 1000, price: 12, amount: 25 },
  { time: BASE_TIME + 30 * 60 * 1000, price: 8, amount: 75 } // close
];

const EXPECTED_OPEN = 10;
const EXPECTED_HIGH = 15;
const EXPECTED_LOW = 5;
const EXPECTED_CLOSE = 8;
const EXPECTED_VOLUME = 100 + 50 + 200 + 25 + 75; // 450

async function seedTrades(trades) {
  const rows = trades.map((t) => ({
    asset_code: ASSET_CODE,
    asset_issuer: ASSET_ISSUER,
    base_account: 'GBASEACCOUNTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    counter_account: 'GCOUNTERACCOUNTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    base_amount: t.amount,
    counter_amount: t.price * t.amount,
    price: t.price,
    base_is_seller: true,
    timestamp: t.time
  }));

  await db('trades').insert(rows);
}

async function clearTrades() {
  await db('trades')
    .where({ asset_code: ASSET_CODE, asset_issuer: ASSET_ISSUER })
    .del();
}

describe('GET /asset/:code/:issuer/price-history', () => {
  beforeEach(async () => {
    await clearTrades();
  });

  afterAll(async () => {
    await clearTrades();
  });

  it('produces a single candle with correct OHLC values for 5 trades in one hour', async () => {
    await seedTrades(TRADES);

    const res = await request(app)
      .get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/price-history`)
      .query({ resolution: '1h' })
      .expect(200);

    expect(res.body).toHaveProperty('candles');
    expect(Array.isArray(res.body.candles)).toBe(true);
    expect(res.body.candles).toHaveLength(1);

    const candle = res.body.candles[0];
    expect(candle.open).toBe(EXPECTED_OPEN);
    expect(candle.high).toBe(EXPECTED_HIGH);
    expect(candle.low).toBe(EXPECTED_LOW);
    expect(candle.close).toBe(EXPECTED_CLOSE);
  });

  it('sums all trade volumes within the candle interval', async () => {
    await seedTrades(TRADES);

    const res = await request(app)
      .get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/price-history`)
      .query({ resolution: '1h' })
      .expect(200);

    expect(res.body.candles).toHaveLength(1);
    expect(res.body.candles[0].volume).toBe(EXPECTED_VOLUME);
  });

  it('returns an empty candles array when the asset has no trade history', async () => {
    const res = await request(app)
      .get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/price-history`)
      .query({ resolution: '1h' })
      .expect(200);

    expect(res.body).toHaveProperty('candles');
    expect(Array.isArray(res.body.candles)).toBe(true);
    expect(res.body.candles).toHaveLength(0);
  });

  it('produces different candle interval sizes for ?resolution=1h and ?resolution=7d', async () => {
    // Spread trades across multiple days so that 1h and 7d resolutions differ.
    const spreadTrades = [
      { time: BASE_TIME, price: 10, amount: 10 },
      { time: BASE_TIME + 2 * HOUR_MS, price: 11, amount: 10 },
      { time: BASE_TIME + 1 * DAY_MS, price: 12, amount: 10 },
      { time: BASE_TIME + 3 * DAY_MS, price: 13, amount: 10 },
      { time: BASE_TIME + 6 * DAY_MS, price: 14, amount: 10 }
    ];
    await seedTrades(spreadTrades);

    const hourlyRes = await request(app)
      .get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/price-history`)
      .query({ resolution: '1h' })
      .expect(200);

    const weeklyRes = await request(app)
      .get(`/asset/${ASSET_CODE}/${ASSET_ISSUER}/price-history`)
      .query({ resolution: '7d' })
      .expect(200);

    expect(Array.isArray(hourlyRes.body.candles)).toBe(true);
    expect(Array.isArray(weeklyRes.body.candles)).toBe(true);

    // Hourly resolution should produce more (smaller) candles than weekly resolution.
    expect(hourlyRes.body.candles.length).toBeGreaterThan(
      weeklyRes.body.candles.length
    );

    // Verify the interval sizes differ by checking the spacing between candle timestamps.
    const hourlyInterval = getIntervalMs(hourlyRes.body.candles);
    const weeklyInterval = getIntervalMs(weeklyRes.body.candles);

    expect(hourlyInterval).toBe(HOUR_MS);
    expect(weeklyInterval).toBe(7 * DAY_MS);
    expect(hourlyInterval).not.toBe(weeklyInterval);
  });
});

function getIntervalMs(candles) {
  if (!candles || candles.length < 2) {
    return null;
  }
  const times = candles
    .map((c) => new Date(c.timestamp || c.time || c.start).getTime())
    .sort((a, b) => a - b);
  return times[1] - times[0];
}