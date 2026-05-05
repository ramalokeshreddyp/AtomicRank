--[[
  submit_answer.lua
  ==================
  Atomically processes a player's answer to a quiz round.
  Enforces business rules and updates state in a single EVAL call,
  eliminating all possible race conditions.

  KEYS:
    KEYS[1] = game_round:{gameId}:{roundId}   — Hash (fields: endTime, correctAnswer)
    KEYS[2] = submissions:{gameId}:{roundId}  — Set  (tracks who has submitted)
    KEYS[3] = leaderboard:global              — Sorted Set (global scores)

  ARGV:
    ARGV[1] = playerId        (string)
    ARGV[2] = answer          (string)
    ARGV[3] = currentTimeMs   (Unix timestamp in milliseconds, as string)
    ARGV[4] = pointsForCorrect (integer, e.g. "10")

  Returns (array of 2):
    { 0,  "<newScore>" }          — SUCCESS
    { -1, "ROUND_EXPIRED" }       — round has ended
    { -2, "DUPLICATE_SUBMISSION"} — player already answered this round
    { -3, "ROUND_NOT_FOUND" }     — game_round key doesn't exist

  Why Lua?
  ---------
  A naive implementation would require multiple round-trips:
    1. HGET endTime → network wait
    2. SISMEMBER submissions → network wait
    3. SADD + ZINCRBY → two more trips

  Each gap between these calls is a window for another concurrent
  request to sneak in and violate the duplicate-check invariant.
  Running inside EVAL collapses all of this to a single atomic transaction
  with zero intermediate network round-trips.
]]

local roundKey       = KEYS[1]
local submissionsKey = KEYS[2]
local leaderboardKey = KEYS[3]

local playerId        = ARGV[1]
local answer          = ARGV[2]
local currentTimeMs   = tonumber(ARGV[3])
local pointsCorrect   = tonumber(ARGV[4])

-- ── Guard 1: Round must exist ─────────────────────────────────────────────────
local endTime = redis.call('HGET', roundKey, 'endTime')
if not endTime then
  return { -3, 'ROUND_NOT_FOUND' }
end

-- ── Guard 2: Round must still be active ──────────────────────────────────────
if currentTimeMs > tonumber(endTime) then
  return { -1, 'ROUND_EXPIRED' }
end

-- ── Guard 3: Player may only submit once per round ────────────────────────────
local alreadySubmitted = redis.call('SISMEMBER', submissionsKey, playerId)
if alreadySubmitted == 1 then
  return { -2, 'DUPLICATE_SUBMISSION' }
end

-- ── Record the submission ─────────────────────────────────────────────────────
redis.call('SADD', submissionsKey, playerId)

-- ── Update score if answer is correct ────────────────────────────────────────
local correctAnswer = redis.call('HGET', roundKey, 'correctAnswer')
local newScore

if correctAnswer and correctAnswer == answer then
  -- Atomically increment in the Sorted Set; returns new score as bulk string
  newScore = redis.call('ZINCRBY', leaderboardKey, pointsCorrect, playerId)
else
  -- Wrong answer — just read the current score (or default to 0)
  local current = redis.call('ZSCORE', leaderboardKey, playerId)
  if current then
    newScore = current
  else
    -- Ensure player exists in leaderboard with 0 points
    redis.call('ZADD', leaderboardKey, 'NX', 0, playerId)
    newScore = '0'
  end
end

return { 0, newScore }
