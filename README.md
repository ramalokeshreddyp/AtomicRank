# QuizArena — Redis-Powered Game Leaderboard

A high-performance, production-ready backend for a real-time quiz game platform. Demonstrates advanced Redis data structures, atomic Lua scripting, Pub/Sub messaging, and Server-Sent Events for live browser updates.

[![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)](https://docker.com)
[![Redis](https://img.shields.io/badge/Redis-7.x-red?logo=redis)](https://redis.io)
[![Node.js](https://img.shields.io/badge/Node.js-20-green?logo=node.js)](https://nodejs.org)

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Redis Key Schema](#redis-key-schema)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Lua Scripts — Deep Dive](#lua-scripts--deep-dive)
- [Real-Time Events (SSE)](#real-time-events-sse)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)

---

## Architecture Overview

```
Browser (Dashboard)
    │
    ├─ REST API calls (login, submit answer, leaderboard)
    └─ GET /api/events ─────► SSE (Server-Sent Events)
                                      │
                                      ▼
                          ┌───────────────────────┐
                          │    Express API Server  │
                          │                        │
                          │  publisher (ioredis) ──┼──► HSET/ZADD/EVAL
                          │  subscriber (ioredis) ◄┼──── SUBSCRIBE
                          └───────────┬────────────┘
                                      │  PUBLISH / SUBSCRIBE
                                      ▼
                          ┌───────────────────────┐
                          │       Redis 7          │
                          │                        │
                          │  Hashes   → sessions   │
                          │  Sorted Sets → LB      │
                          │  Sets     → index/subs │
                          │  Pub/Sub  → events     │
                          └───────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| Two Redis connections | A connection enters dedicated Pub/Sub mode after `SUBSCRIBE`. Regular commands cannot be issued on it, so a separate `publisher` connection handles all HSET/ZADD/EVAL work |
| SSE fan-out pattern | One shared Redis subscriber fans out to all connected SSE clients in-process. Avoids N Redis connections for N browser tabs |
| Lua for multi-step atomicity | Race conditions are eliminated by executing read-modify-write sequences as a single atomic Redis script, not as separate round-trips |
| ZINCRBY for scores | Sorted Set increment is itself atomic — no Lua needed for simple score additions |
| Pipeline for leaderboard queries | Rank lookups use `publisher.pipeline()` to batch ZSCORE + ZREVRANK + ZCARD into a single network round-trip |

---

## Redis Key Schema

| Data Type | Key Pattern | Example | Description |
|---|---|---|---|
| Hash | `session:{sessionId}` | `session:uuid-123` | Per-session data (userId, IP, device, timestamps) |
| Set | `user_sessions:{userId}` | `user_sessions:42` | All active session IDs for a user |
| Sorted Set | `leaderboard:global` | `leaderboard:global` | All players ranked by total score |
| Sorted Set | `leaderboard:game:{gameId}` | `leaderboard:game:g-1` | Per-game leaderboard |
| Hash | `game_round:{gameId}:{roundId}` | `game_round:g-1:r-3` | Round metadata (endTime, correctAnswer) |
| Set | `submissions:{gameId}:{roundId}` | `submissions:g-1:r-3` | Players who have already submitted |

---

## Quick Start

### Prerequisites
- Docker ≥ 24.x
- Docker Compose ≥ 2.x

### 1. Clone and configure

```bash
git clone <your-repo-url>
cd GPP-13
cp .env.example .env
```

### 2. Start all services

```bash
docker-compose up --build
```

All containers will be healthy within ~60 seconds. You'll see:

```
quiz_redis  | Ready to accept connections
quiz_api    | [Redis Publisher] Ready
quiz_api    | [API] Server listening on port 3000
```

### 3. Open the dashboard

Navigate to **http://localhost:3000** in your browser.

### 4. Verify health

```bash
curl http://localhost:3000/health
# → {"status":"OK","redis":"connected"}
```

---

## API Reference

### Session Management

#### `POST /api/sessions` — Create session
```json
// Request
{ "userId": "user-42", "ipAddress": "192.168.1.1", "deviceType": "desktop" }

// Response 201
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000" }
```
Old sessions for the same `userId` are **atomically invalidated** via Lua before the new one is created.

---

### Leaderboard

#### `POST /api/leaderboard/scores` — Submit score
```json
// Request
{ "playerId": "player-alpha", "points": 50 }

// Response 200
{ "playerId": "player-alpha", "newScore": 75 }
```

#### `GET /api/leaderboard/top/:count` — Top N players
```json
[
  { "rank": 1, "playerId": "player-alpha", "score": 500 },
  { "rank": 2, "playerId": "player-beta",  "score": 480 }
]
```

#### `GET /api/leaderboard/player/:playerId` — Player rank + context
```json
{
  "playerId": "player-alpha",
  "score": 500,
  "rank": 1,
  "percentile": 98.5,
  "nearbyPlayers": {
    "above": [],
    "below": [{ "rank": 2, "playerId": "player-beta", "score": 480 }]
  }
}
```

---

### Game

#### `POST /api/game/rounds` — Create a round (seed/test helper)
```json
{ "gameId": "game-1", "roundId": "round-1", "correctAnswer": "Paris", "durationSeconds": 300 }
```

#### `POST /api/game/submit` — Submit answer (atomic Lua)
```json
// Request
{ "gameId": "game-1", "roundId": "round-1", "playerId": "player-alpha", "answer": "Paris" }

// Success 200
{ "status": "SUCCESS", "newScore": 510 }

// Duplicate 400
{ "status": "ERROR", "code": "DUPLICATE_SUBMISSION" }

// Expired 403
{ "status": "ERROR", "code": "ROUND_EXPIRED" }
```

---

### SSE

#### `GET /api/events` — Real-time event stream
```
Content-Type: text/event-stream

event: connected
data: {"message":"SSE stream connected"}

event: leaderboard_updated
data: {"playerId":"player-alpha","newScore":510}
```

---

### Admin

#### `GET /api/admin/sessions/user/:userId`
```json
[
  { "sessionId": "abc-123", "ipAddress": "1.2.3.4", "lastActive": "2026-05-05T...", "deviceType": "desktop" }
]
```

#### `DELETE /api/admin/sessions/:sessionId` → `204 No Content`

---

## Lua Scripts — Deep Dive

### Why Lua Scripts?

Redis is single-threaded but handles many concurrent clients. Without atomicity, a **race condition** can corrupt data:

```
Client A reads sessions for user-42: [sid1, sid2]
Client B reads sessions for user-42: [sid1, sid2]
Client A deletes sid1, sid2
Client B deletes sid1, sid2  ← double-delete, no problem here
Client A creates sid3, adds to set
Client B creates sid4, adds to set
→ user-42 now has TWO active sessions — WRONG!
```

A Lua script sent via `EVAL` is executed **atomically on the Redis server**. No other command can interleave while the script runs, making the entire read-modify-write sequence indivisible.

---

### `invalidate_sessions.lua`

**Purpose:** Before creating a new session, atomically delete all existing sessions for a user.

```lua
local userSessionsKey = KEYS[1]   -- user_sessions:{userId}

local sessions = redis.call('SMEMBERS', userSessionsKey)
local count = #sessions

for _, sid in ipairs(sessions) do
  redis.call('DEL', 'session:' .. sid)
end

if count > 0 then
  redis.call('DEL', userSessionsKey)
end

return count
```

**Why one EVAL beats multiple commands:**
Without Lua, you'd need: `SMEMBERS` → loop `DEL` → `DEL`. Each call is a separate network round-trip, and between any two of them, another `POST /api/sessions` for the same user could partially overlap, leading to phantom sessions that never get cleaned up.

**Inputs:**
- `KEYS[1]` = `user_sessions:{userId}`

**Returns:** number of sessions invalidated.

---

### `submit_answer.lua`

**Purpose:** Atomically process a quiz answer — check round validity, prevent duplicates, and conditionally award points.

```lua
-- Guard 1: Round must exist
local endTime = redis.call('HGET', KEYS[1], 'endTime')
if not endTime then return { -3, 'ROUND_NOT_FOUND' } end

-- Guard 2: Round must still be active
if tonumber(ARGV[3]) > tonumber(endTime) then
  return { -1, 'ROUND_EXPIRED' }
end

-- Guard 3: No duplicate submission
local alreadySubmitted = redis.call('SISMEMBER', KEYS[2], ARGV[1])
if alreadySubmitted == 1 then
  return { -2, 'DUPLICATE_SUBMISSION' }
end

-- Record submission
redis.call('SADD', KEYS[2], ARGV[1])

-- Award points if correct
local correctAnswer = redis.call('HGET', KEYS[1], 'correctAnswer')
if correctAnswer == ARGV[2] then
  return { 0, redis.call('ZINCRBY', KEYS[3], ARGV[4], ARGV[1]) }
else
  return { 0, redis.call('ZSCORE', KEYS[3], ARGV[1]) or '0' }
end
```

**Why this must be atomic:**

Consider two players submitting simultaneously. Without atomicity:

```
Player A checks SISMEMBER → 0 (not submitted)
Player B checks SISMEMBER → 0 (not submitted)  ← squeezed in between
Player A calls SADD + ZINCRBY → gets points
Player B calls SADD + ZINCRBY → ALSO gets points ← BUG: double scoring!
```

The Lua script collapses all six Redis commands into a single indivisible operation. Redis's single-threaded command processor serialises EVAL execution — Player B's script cannot start until Player A's is fully complete.

**Inputs:**
- `KEYS[1]` = `game_round:{gameId}:{roundId}`
- `KEYS[2]` = `submissions:{gameId}:{roundId}`
- `KEYS[3]` = `leaderboard:global`
- `ARGV[1]` = `playerId`
- `ARGV[2]` = `answer`
- `ARGV[3]` = current timestamp in ms
- `ARGV[4]` = points for correct answer

**Returns:** `[statusCode, payload]` — the API layer maps codes to HTTP responses.

---

## Real-Time Events (SSE)

The SSE pipeline works as follows:

1. **Client connects** to `GET /api/events`
2. Server adds the response object to a `Set<Response>` (fan-out registry)
3. The **single shared Redis subscriber** is subscribed to `game-events` channel
4. When a score is updated, the leaderboard route calls `PUBLISH game-events {...}`
5. The subscriber receives the message and **fans it out** to all entries in the registry
6. Each response object has `.write()` called with the SSE-formatted string

This means **N browser tabs = 1 Redis subscriber connection**, regardless of concurrency.

---

## Environment Variables

| Variable | Default | Required | Description |
|---|---|---|---|
| `REDIS_URL` | `redis://redis:6379` | Yes | Redis connection string |
| `API_PORT` | `3000` | Yes | HTTP server port |
| `NODE_ENV` | `production` | No | Node environment |
| `SESSION_TTL` | `1800` | No | Session TTL in seconds |
| `CORRECT_ANSWER_POINTS` | `10` | No | Points awarded for correct answer |

---

## Project Structure

```
GPP-13/
├── docker-compose.yml          # Orchestrates api + redis
├── Dockerfile                  # Multi-stage Node.js image
├── .env.example                # Environment variable docs
├── submission.json             # Evaluator config
├── MEMORY_ANALYSIS.md          # Redis memory findings
├── README.md                   # This file
├── package.json
├── src/
│   ├── index.js                # Express entry + /health
│   ├── config/
│   │   └── redis.js            # Publisher + Subscriber clients
│   ├── routes/
│   │   ├── sessions.js         # POST /api/sessions
│   │   ├── leaderboard.js      # Score + ranking endpoints
│   │   ├── game.js             # Answer submission (Lua)
│   │   ├── events.js           # SSE endpoint
│   │   └── admin.js            # Admin session management
│   ├── scripts/
│   │   ├── invalidate_sessions.lua
│   │   └── submit_answer.lua
│   └── middleware/
│       └── errorHandler.js
└── public/
    ├── index.html              # Dashboard SPA
    ├── style.css               # Dark glassmorphism design
    └── app.js                  # Frontend application
```
