'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { publisher } = require('../config/redis');

const router = express.Router();

const GLOBAL_LEADERBOARD = 'leaderboard:global';
const CORRECT_ANSWER_POINTS = parseInt(process.env.CORRECT_ANSWER_POINTS || '10', 10);
const GAME_EVENTS_CHANNEL = 'game-events';

// Load Lua script once at module init
const submitScript = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'submit_answer.lua'),
  'utf8'
);

/**
 * POST /api/game/submit
 *
 * Processes a player's quiz answer via a single atomic Lua script that:
 *   1. Checks if the round window is still open (endTime > now)
 *   2. Checks if the player has already submitted for this round
 *   3. Records the submission and conditionally updates the global score
 *
 * The entire operation is atomic — Redis serialises it with no interleaving.
 */
router.post('/submit', async (req, res, next) => {
  try {
    const { gameId, roundId, playerId, answer } = req.body;

    if (!gameId || !roundId || !playerId || answer === undefined) {
      return res.status(400).json({ error: 'Missing required fields: gameId, roundId, playerId, answer' });
    }

    const roundKey       = `game_round:${gameId}:${roundId}`;
    const submissionsKey = `submissions:${gameId}:${roundId}`;
    const currentTimeMs  = Date.now().toString();

    // Single EVAL call — fully atomic on Redis server
    const result = await publisher.eval(
      submitScript,
      3,                           // number of KEYS
      roundKey,
      submissionsKey,
      GLOBAL_LEADERBOARD,
      playerId,                    // ARGV[1]
      String(answer),              // ARGV[2]
      currentTimeMs,               // ARGV[3]
      String(CORRECT_ANSWER_POINTS) // ARGV[4]
    );

    const [code, payload] = result;

    if (code === 0) {
      const newScore = parseFloat(payload);

      // Publish score update event to all SSE listeners
      await publisher.publish(GAME_EVENTS_CHANNEL, JSON.stringify({
        event: 'score_updated',
        data: { playerId, newScore, gameId, roundId },
      }));

      return res.status(200).json({ status: 'SUCCESS', newScore });
    }

    if (code === -1) {
      return res.status(403).json({ status: 'ERROR', code: 'ROUND_EXPIRED' });
    }

    if (code === -2) {
      return res.status(400).json({ status: 'ERROR', code: 'DUPLICATE_SUBMISSION' });
    }

    if (code === -3) {
      return res.status(404).json({ status: 'ERROR', code: 'ROUND_NOT_FOUND' });
    }

    // Unexpected code
    return res.status(500).json({ status: 'ERROR', code: 'INTERNAL_ERROR' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/game/rounds
 * Helper endpoint to seed/create a game round for testing.
 */
router.post('/rounds', async (req, res, next) => {
  try {
    const { gameId, roundId, correctAnswer, durationSeconds } = req.body;

    if (!gameId || !roundId || !correctAnswer || !durationSeconds) {
      return res.status(400).json({
        error: 'Missing required fields: gameId, roundId, correctAnswer, durationSeconds',
      });
    }

    const roundKey = `game_round:${gameId}:${roundId}`;
    const endTime = (Date.now() + parseInt(durationSeconds, 10) * 1000).toString();

    await publisher.hset(roundKey, {
      gameId,
      roundId,
      correctAnswer,
      endTime,
      createdAt: new Date().toISOString(),
    });

    // Round expires from Redis 1 hour after endTime to allow result queries
    await publisher.expireat(roundKey, Math.ceil(Date.now() / 1000) + parseInt(durationSeconds, 10) + 3600);

    return res.status(201).json({
      gameId,
      roundId,
      correctAnswer,
      endTime: new Date(parseInt(endTime)).toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
