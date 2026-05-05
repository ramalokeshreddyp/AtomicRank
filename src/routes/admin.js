'use strict';

const express = require('express');
const { publisher } = require('../config/redis');

const router = express.Router();

// ─── GET /api/admin/sessions/user/:userId ─────────────────────────────────────
/**
 * Returns all active session objects for a given user.
 * Reads the user's session Set, then fetches each session Hash in a pipeline.
 */
router.get('/sessions/user/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const userSessionsKey = `user_sessions:${userId}`;

    const sessionIds = await publisher.smembers(userSessionsKey);

    if (!sessionIds || sessionIds.length === 0) {
      return res.status(200).json([]);
    }

    // Batch-fetch all session Hashes in a single pipeline round-trip
    const pipeline = publisher.pipeline();
    for (const sid of sessionIds) {
      pipeline.hgetall(`session:${sid}`);
    }
    const results = await pipeline.exec();

    const sessions = [];
    for (let i = 0; i < sessionIds.length; i++) {
      const [err, data] = results[i];
      if (err || !data || Object.keys(data).length === 0) {
        // Session hash missing (expired) — remove stale ID from set
        await publisher.srem(userSessionsKey, sessionIds[i]);
        continue;
      }
      sessions.push({
        sessionId: sessionIds[i],
        ipAddress: data.ipAddress,
        lastActive: data.lastActive,
        deviceType: data.deviceType,
        createdAt: data.createdAt,
        userId: data.userId,
      });
    }

    return res.status(200).json(sessions);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/sessions/:sessionId ────────────────────────────────────
/**
 * Invalidates a single session by:
 *   1. Looking up the userId from the session Hash
 *   2. Deleting the session Hash
 *   3. Removing the sessionId from the user's session Set
 */
router.delete('/sessions/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const sessionKey = `session:${sessionId}`;

    // Read userId before deleting
    const userId = await publisher.hget(sessionKey, 'userId');

    if (!userId) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Remove session Hash and user index entry atomically via pipeline
    const pipeline = publisher.pipeline();
    pipeline.del(sessionKey);
    pipeline.srem(`user_sessions:${userId}`, sessionId);
    await pipeline.exec();

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
