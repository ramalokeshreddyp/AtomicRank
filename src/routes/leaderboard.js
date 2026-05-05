'use strict';

const express = require('express');
const { publisher } = require('../config/redis');

const router = express.Router();

const GLOBAL_LEADERBOARD = 'leaderboard:global';
const GAME_EVENTS_CHANNEL = 'game-events';

// ─── POST /api/leaderboard/scores ────────────────────────────────────────────
/**
 * Atomically increments a player's score using ZINCRBY.
 * After updating, publishes a leaderboard_updated event to the Pub/Sub channel
 * so all connected SSE clients receive the update in real-time.
 */
router.post('/scores', async (req, res, next) => {
  try {
    const { playerId, points } = req.body;

    if (!playerId || points === undefined || points === null) {
      return res.status(400).json({ error: 'Missing required fields: playerId, points' });
    }

    const parsedPoints = Number(points);
    if (isNaN(parsedPoints)) {
      return res.status(400).json({ error: 'points must be a number' });
    }

    // ZINCRBY is atomic — no Lua needed for a single increment
    const newScoreStr = await publisher.zincrby(GLOBAL_LEADERBOARD, parsedPoints, String(playerId));
    const newScore = parseFloat(newScoreStr);

    // Publish real-time event for SSE consumers
    const eventPayload = JSON.stringify({ playerId, newScore });
    await publisher.publish(GAME_EVENTS_CHANNEL, JSON.stringify({
      event: 'leaderboard_updated',
      data: { playerId, newScore },
    }));

    return res.status(200).json({ playerId, newScore });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/leaderboard/top/:count ─────────────────────────────────────────
/**
 * Returns the top N players from the global leaderboard in descending score order.
 */
router.get('/top/:count', async (req, res, next) => {
  try {
    const count = parseInt(req.params.count, 10);
    if (isNaN(count) || count < 1) {
      return res.status(400).json({ error: 'count must be a positive integer' });
    }

    // ZREVRANGE returns members with scores in descending order
    const results = await publisher.zrevrange(GLOBAL_LEADERBOARD, 0, count - 1, 'WITHSCORES');

    const players = [];
    for (let i = 0; i < results.length; i += 2) {
      players.push({
        rank: Math.floor(i / 2) + 1,
        playerId: results[i],
        score: parseFloat(results[i + 1]),
      });
    }

    return res.status(200).json(players);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/leaderboard/player/:playerId ────────────────────────────────────
/**
 * Returns a specific player's rank, score, percentile, and nearby players window.
 * Uses multiple pipelined Redis calls to minimise latency.
 */
router.get('/player/:playerId', async (req, res, next) => {
  try {
    const { playerId } = req.params;

    // Pipeline: score, rank (0-indexed from top), total players
    const pipeline = publisher.pipeline();
    pipeline.zscore(GLOBAL_LEADERBOARD, playerId);
    pipeline.zrevrank(GLOBAL_LEADERBOARD, playerId);
    pipeline.zcard(GLOBAL_LEADERBOARD);
    const [[, scoreStr], [, revRank], [, total]] = await pipeline.exec();

    if (scoreStr === null || revRank === null) {
      return res.status(404).json({ error: 'Player not found in leaderboard' });
    }

    const score = parseFloat(scoreStr);
    const rank = revRank + 1;           // 1-indexed
    const totalPlayers = total || 1;

    // Percentile: what percentage of players this player outranks
    const percentile = parseFloat(
      (((totalPlayers - rank) / totalPlayers) * 100).toFixed(2)
    );

    // Fetch up to 2 players above (higher score = lower index in ZREVRANGE)
    // and up to 2 players below (lower score = higher index)
    //
    // revRank is 0-indexed position in the sorted-by-desc-score list.
    // Players above: indices [revRank-2, revRank-1] — these are ranked higher.
    // Players below: indices [revRank+1, revRank+2] — these are ranked lower.
    const aboveStart = Math.max(0, revRank - 2);
    const aboveEnd   = revRank - 1;   // -1 means we exclude the player itself
    const belowStart = revRank + 1;
    const belowEnd   = revRank + 2;

    const pipeline2 = publisher.pipeline();
    // Only fetch above range if there are players above
    if (aboveEnd >= 0 && revRank > 0) {
      pipeline2.zrevrange(GLOBAL_LEADERBOARD, aboveStart, aboveEnd, 'WITHSCORES');
    } else {
      pipeline2.zrevrange(GLOBAL_LEADERBOARD, 0, -2, 'WITHSCORES'); // empty trick: start > end means empty
    }
    pipeline2.zrevrange(GLOBAL_LEADERBOARD, belowStart, belowEnd, 'WITHSCORES');
    const [[, aboveRaw], [, belowRaw]] = await pipeline2.exec();

    const parseWindow = (raw, startRank) => {
      const players = [];
      if (!raw) return players;
      for (let i = 0; i < raw.length; i += 2) {
        players.push({
          rank: startRank + Math.floor(i / 2),
          playerId: raw[i],
          score: parseFloat(raw[i + 1]),
        });
      }
      return players;
    };

    const abovePlayers = parseWindow(aboveRaw || [], aboveStart + 1);
    const belowPlayers = parseWindow(belowRaw || [], rank + 1);

    return res.status(200).json({
      playerId,
      score,
      rank,
      percentile,
      nearbyPlayers: {
        above: abovePlayers,
        below: belowPlayers,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
