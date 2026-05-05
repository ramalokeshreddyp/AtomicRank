'use strict';

const express = require('express');
const Redis = require('ioredis');

const router = express.Router();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const GAME_EVENTS_CHANNEL = 'game-events';

// In-memory fan-out: tracks all active SSE response objects
// so a single subscriber feeds N clients without N Redis connections.
const sseClients = new Set();

// ─── Single shared subscriber for SSE fan-out ─────────────────────────────────
// We deliberately create ONE dedicated Redis subscriber here (not reusing the
// module-level one) so that SSE connections don't interfere with each other or
// with the rest of the app's subscribe usage.
let sharedSseSubscriber = null;

function getSseSubscriber() {
  if (!sharedSseSubscriber) {
    sharedSseSubscriber = new Redis(REDIS_URL, {
      connectionName: 'sse-subscriber',
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    sharedSseSubscriber.on('error', (err) =>
      console.error('[SSE Subscriber] Error:', err.message)
    );

    // Subscribe to the game events channel once
    sharedSseSubscriber.subscribe(GAME_EVENTS_CHANNEL, (err, count) => {
      if (err) {
        console.error('[SSE Subscriber] Failed to subscribe:', err.message);
      } else {
        console.log(`[SSE Subscriber] Subscribed to ${GAME_EVENTS_CHANNEL} (total: ${count})`);
      }
    });

    // Fan-out: broadcast each incoming message to all connected SSE clients
    sharedSseSubscriber.on('message', (channel, message) => {
      if (channel !== GAME_EVENTS_CHANNEL) return;

      let parsed;
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }

      const { event = 'message', data = {} } = parsed;
      const ssePayload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

      for (const clientRes of sseClients) {
        try {
          clientRes.write(ssePayload);
        } catch {
          sseClients.delete(clientRes);
        }
      }
    });
  }

  return sharedSseSubscriber;
}

/**
 * GET /api/events
 *
 * Server-Sent Events endpoint.
 * Keeps a long-lived HTTP connection open and streams game events published
 * via Redis Pub/Sub to the browser in real-time.
 *
 * The fan-out pattern means we only ever hold ONE Redis subscriber connection
 * regardless of how many browser tabs are connected.
 */
router.get('/', (req, res) => {
  // Ensure the SSE subscriber is initialised
  getSseSubscriber();

  // ── SSE headers ────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // Disable nginx buffering if proxied
  res.flushHeaders();

  // Send an initial "connected" event so the client knows the stream is live
  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'SSE stream connected', timestamp: new Date().toISOString() })}\n\n`);

  // Register this client
  sseClients.add(res);
  console.log(`[SSE] Client connected — total: ${sseClients.size}`);

  // Keep-alive heartbeat every 25 s to prevent proxy timeouts
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25000);

  // Clean up when client disconnects
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(`[SSE] Client disconnected — total: ${sseClients.size}`);
  });
});

module.exports = router;
