'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { publisher, subscriber, waitForReady } = require('./config/redis');

const sessionsRouter = require('./routes/sessions');
const leaderboardRouter = require('./routes/leaderboard');
const gameRouter = require('./routes/game');
const eventsRouter = require('./routes/events');
const adminRouter = require('./routes/admin');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = parseInt(process.env.API_PORT || '3000', 10);

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await publisher.ping();
    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      redis: 'connected',
    });
  } catch (err) {
    res.status(503).json({
      status: 'ERROR',
      message: 'Redis connection failed',
      error: err.message,
    });
  }
});

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/sessions', sessionsRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/game', gameRouter);
app.use('/api/events', eventsRouter);
app.use('/api/admin', adminRouter);

// ─── Fallback SPA route ──────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Error Handler ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Server Startup ──────────────────────────────────────────────────────────
async function start() {
  try {
    console.log('[API] Waiting for Redis connection…');
    await waitForReady();
    console.log('[API] Redis connected ✓');

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[API] Server listening on port ${PORT}`);
      console.log(`[API] Health: http://localhost:${PORT}/health`);
      console.log(`[API] Dashboard: http://localhost:${PORT}/`);
    });
  } catch (err) {
    console.error('[API] Startup failed:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
