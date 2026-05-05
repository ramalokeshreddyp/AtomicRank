'use strict';

const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ─── Shared Redis options ────────────────────────────────────────────────────
const commonOptions = {
  maxRetriesPerRequest: null,        // ioredis internal
  enableReadyCheck: true,
  lazyConnect: true,
  retryStrategy(times) {
    // Exponential back-off, capped at 5 s
    const delay = Math.min(times * 200, 5000);
    console.log(`[Redis] Reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
};

// ─── Publisher client (commands + PUBLISH) ───────────────────────────────────
const publisher = new Redis(REDIS_URL, {
  ...commonOptions,
  connectionName: 'publisher',
});

// ─── Subscriber client (SUBSCRIBE / PSUBSCRIBE) ──────────────────────────────
// A Redis connection enters a dedicated mode once SUBSCRIBE is called.
// It cannot be used for regular commands after that, so we keep it separate.
const subscriber = new Redis(REDIS_URL, {
  ...commonOptions,
  connectionName: 'subscriber',
});

publisher.on('error', (err) => console.error('[Redis Publisher] Error:', err.message));
publisher.on('connect', () => console.log('[Redis Publisher] Connected'));
publisher.on('ready', () => console.log('[Redis Publisher] Ready'));

subscriber.on('error', (err) => console.error('[Redis Subscriber] Error:', err.message));
subscriber.on('connect', () => console.log('[Redis Subscriber] Connected'));
subscriber.on('ready', () => console.log('[Redis Subscriber] Ready'));

/**
 * Wait until both Redis connections are ready.
 * Called at server startup before accepting traffic.
 */
async function waitForReady() {
  await Promise.all([publisher.connect(), subscriber.connect()]);
}

module.exports = { publisher, subscriber, waitForReady };
