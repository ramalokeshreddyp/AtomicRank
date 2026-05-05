'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { publisher } = require('../config/redis');

const router = express.Router();

const SESSION_TTL = parseInt(process.env.SESSION_TTL || '1800', 10);

// Load Lua script once at module init
const invalidateScript = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'invalidate_sessions.lua'),
  'utf8'
);

/**
 * POST /api/sessions
 * Creates a new user session, atomically invalidating any existing sessions
 * for the same userId before persisting the new one.
 */
router.post('/', async (req, res, next) => {
  try {
    const { userId, ipAddress, deviceType } = req.body;

    if (!userId || !ipAddress || !deviceType) {
      return res.status(400).json({
        error: 'Missing required fields: userId, ipAddress, deviceType',
      });
    }

    const userSessionsKey = `user_sessions:${userId}`;
    const sessionId = uuidv4();
    const sessionKey = `session:${sessionId}`;
    const now = new Date().toISOString();

    // ── Step 1: Atomically invalidate all old sessions via Lua ──────────────
    // Using EVAL directly so the script runs as one atomic Redis command.
    // This prevents any race condition between reading old sessions and
    // deleting them while another login request might be in-flight.
    await publisher.eval(invalidateScript, 1, userSessionsKey);

    // ── Step 2: Create the new session Hash ─────────────────────────────────
    await publisher.hset(sessionKey, {
      userId,
      createdAt: now,
      lastActive: now,
      ipAddress,
      deviceType,
    });

    // Set 30-minute sliding expiration
    await publisher.expire(sessionKey, SESSION_TTL);

    // ── Step 3: Register the new session ID in the user's index Set ─────────
    await publisher.sadd(userSessionsKey, sessionId);

    return res.status(201).json({ sessionId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
