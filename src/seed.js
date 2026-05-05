'use strict';

/**
 * Seed script for development / evaluation.
 * Run: docker-compose exec api node src/seed.js
 *
 * Seeds:
 *   - 35 players on leaderboard:global with varied scores
 *   - One active game round (game-seed, round-1)
 */

require('dotenv').config();
const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(REDIS_URL);

async function seed() {
  console.log('[Seed] Connecting to Redis…');
  await redis.ping();
  console.log('[Seed] Connected ✓');

  // ── Clear existing leaderboard ──────────────────────────────────────────────
  await redis.del('leaderboard:global');
  console.log('[Seed] Cleared leaderboard:global');

  // ── Seed 35 players ─────────────────────────────────────────────────────────
  const players = [
    'player-alpha', 'player-beta', 'player-gamma', 'player-delta', 'player-epsilon',
    'player-zeta', 'player-eta', 'player-theta', 'player-iota', 'player-kappa',
    'player-lambda', 'player-mu', 'player-nu', 'player-xi', 'player-omicron',
    'player-pi', 'player-rho', 'player-sigma', 'player-tau', 'player-upsilon',
    'player-phi', 'player-chi', 'player-psi', 'player-omega', 'player-A',
    'player-B', 'player-C', 'player-D', 'player-E', 'player-F',
    'player-G', 'player-H', 'player-I', 'player-J', 'player-K',
  ];

  const pipeline = redis.pipeline();
  players.forEach((p, i) => {
    const score = 1000 - i * 20 + Math.floor(Math.random() * 15);
    pipeline.zadd('leaderboard:global', score, p);
  });
  await pipeline.exec();
  console.log(`[Seed] Added ${players.length} players to leaderboard:global`);

  // ── Seed active game round ──────────────────────────────────────────────────
  const roundKey = 'game_round:game-seed:round-1';
  const endTime = (Date.now() + 10 * 60 * 1000).toString(); // 10 min from now
  await redis.hset(roundKey, {
    gameId: 'game-seed',
    roundId: 'round-1',
    correctAnswer: 'Paris',
    endTime,
    createdAt: new Date().toISOString(),
  });
  await redis.expire(roundKey, 3600);
  console.log('[Seed] Created active round: game-seed/round-1 (answer: Paris)');

  // ── Seed expired game round ─────────────────────────────────────────────────
  const expiredRoundKey = 'game_round:game-seed:round-expired';
  const expiredEndTime = (Date.now() - 5 * 60 * 1000).toString(); // 5 min ago
  await redis.hset(expiredRoundKey, {
    gameId: 'game-seed',
    roundId: 'round-expired',
    correctAnswer: 'London',
    endTime: expiredEndTime,
    createdAt: new Date().toISOString(),
  });
  await redis.expire(expiredRoundKey, 3600);
  console.log('[Seed] Created expired round: game-seed/round-expired (answer: London)');

  console.log('[Seed] Done ✓');
  await redis.quit();
}

seed().catch((err) => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});
