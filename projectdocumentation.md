# Project Documentation
# QuizArena — Redis-Powered Game Leaderboard

> **Version:** 1.0 | **Author:** ramalokeshreddyp | **Repo:** https://github.com/ramalokeshreddyp/AtomicRank

---

## Table of Contents

1. [Project Objective](#1-project-objective)
2. [Problem Statement](#2-problem-statement)
3. [Tech Stack & Rationale](#3-tech-stack--rationale)
4. [Key Features](#4-key-features)
5. [Module Documentation](#5-module-documentation)
6. [Redis Concepts Deep Dive](#6-redis-concepts-deep-dive)
7. [API Contract Reference](#7-api-contract-reference)
8. [Lua Script Internals](#8-lua-script-internals)
9. [Setup & Installation](#9-setup--installation)
10. [Testing Strategy](#10-testing-strategy)
11. [Pros, Cons & Trade-offs](#11-pros-cons--trade-offs)
12. [Advantages & Benefits](#12-advantages--benefits)
13. [Known Limitations](#13-known-limitations)
14. [Future Roadmap](#14-future-roadmap)

---

## 1. Project Objective

Build a **high-performance, production-ready backend** for a real-time competitive quiz game platform demonstrating:

- Advanced Redis data structures (Hashes, Sorted Sets, Sets)
- Atomic operations via Lua scripting to eliminate race conditions
- Live event delivery using Redis Pub/Sub piped into Server-Sent Events (SSE)
- A full-featured admin and player dashboard

**Core insight:** Redis is not just a cache. It is a powerful **in-memory data structure server** capable of handling complex, concurrent, low-latency operations that relational databases struggle with.

---

## 2. Problem Statement

### Why Not a Traditional Database?

```
Traditional DB for a leaderboard with 1M players:

  "What is Player X's rank?"
  → SELECT COUNT(*) FROM scores WHERE score > (SELECT score FROM scores WHERE playerId = X)
  → Full table scan or expensive index on score column
  → 50–500ms per query under load

Redis Sorted Set:
  → ZREVRANK leaderboard:global player-X
  → O(log N) skiplist traversal
  → 0.1–1ms regardless of dataset size
```

### Race Conditions in Multi-Step Operations

```
Problem: "Has this player already submitted? If not, record and score."

Without atomicity:
  Thread A: SISMEMBER submissions player-X → 0 (not submitted)
  Thread B: SISMEMBER submissions player-X → 0 (sees same state!)
  Thread A: SADD submissions player-X + ZINCRBY → scores
  Thread B: SADD submissions player-X + ZINCRBY → scores AGAIN (bug!)

With Lua EVAL:
  The entire check + record + score is ONE atomic server-side operation.
  Thread B cannot interleave.
```

---

## 3. Tech Stack & Rationale

| Technology | Version | Why Chosen |
|---|---|---|
| **Node.js** | 20 LTS | Non-blocking I/O ideal for SSE; excellent ioredis support |
| **Express.js** | 4.x | Minimal, flexible, industry-standard |
| **ioredis** | 5.x | Full-featured: Lua EVAL, pipelines, Pub/Sub, cluster-ready |
| **Redis** | 7 (Alpine) | Latest stable; Sorted Sets, Hashes, Pub/Sub, Lua VM built-in |
| **Docker Compose** | 2.x | Single-command reproducible environment |
| **uuid** | v4 | Cryptographically random 122-bit session IDs |
| **Vanilla JS** | ES6+ | Zero-dependency frontend, no build step |

### ioredis vs redis (npm)

| Feature | ioredis | redis (npm) |
|---|---|---|
| Pipeline support | ✅ Native | ✅ |
| Lua EVAL | ✅ Simple API | ✅ |
| Pub/Sub | ✅ Dedicated mode | ✅ |
| Cluster | ✅ Built-in | ✅ |
| TypeScript | ✅ First-class types | ✅ |
| **Chosen because** | Mature, widely used in production gaming backends | — |

---

## 4. Key Features

### 4.1 Session Management (Req 3 & 4)

- **POST /api/sessions** creates a Redis Hash with 5 fields + 1800s TTL
- Before creating: Lua script atomically purges ALL existing sessions for that user
- `user_sessions:{userId}` Set tracks active session IDs for O(1) lookup

```
HSET session:{uuid}  userId createdAt lastActive ipAddress deviceType
EXPIRE session:{uuid} 1800
SADD user_sessions:{userId} {uuid}
```

### 4.2 Real-Time Leaderboard (Req 5 & 6)

- **ZINCRBY** atomically increments score — no read-modify-write needed
- **ZREVRANGE WITHSCORES** returns top N in O(log N + N)
- Player lookup returns rank, percentile, and a ±2 player context window
- Each score update PUBLISHes to `game-events` for SSE broadcast

### 4.3 Atomic Game Submission (Req 7)

- Single **EVAL** call executes 6 Redis commands atomically
- Guards: round expiry → duplicate submission → correct answer check
- Returns structured codes: `SUCCESS`, `ROUND_EXPIRED`, `DUPLICATE_SUBMISSION`

### 4.4 Server-Sent Events (Req 8)

- One shared Redis subscriber fans out to all connected browser clients
- Events: `connected`, `leaderboard_updated`, `score_updated`
- 25-second heartbeat prevents proxy timeouts

### 4.5 Admin APIs (Req 9)

- List all sessions for a user with full metadata
- Delete individual sessions (removes Hash + cleans Set index)
- Stale TTL-expired session IDs auto-cleaned during list operations

---

## 5. Module Documentation

### `src/index.js` — Application Bootstrap

**Responsibilities:**
- Loads environment variables via `dotenv`
- Mounts all route handlers
- Waits for Redis readiness before accepting traffic
- Exposes `/health` endpoint

**Startup sequence:**
```
1. waitForReady() — connects publisher + subscriber
2. app.listen(PORT) — only called after Redis is ready
3. Logs dashboard URL
```

---

### `src/config/redis.js` — Connection Management

**Exports:** `{ publisher, subscriber, waitForReady }`

**Two-connection design:**

```javascript
// publisher: all regular commands + PUBLISH
const publisher = new Redis(REDIS_URL, { connectionName: 'publisher' });

// subscriber: exclusively for SUBSCRIBE
const subscriber = new Redis(REDIS_URL, { connectionName: 'subscriber' });

// Both use lazyConnect: true — explicit connect on startup
async function waitForReady() {
  await Promise.all([publisher.connect(), subscriber.connect()]);
}
```

**Retry strategy:** Exponential backoff, capped at 5 seconds per retry.

---

### `src/routes/sessions.js` — Session Lifecycle

**Endpoint:** `POST /api/sessions`

**Flow:**
1. Validate `userId`, `ipAddress`, `deviceType`
2. Generate UUID `sessionId`
3. **EVAL** `invalidate_sessions.lua` → atomically delete old sessions
4. **HSET** new session Hash with 5 fields
5. **EXPIRE** 1800 seconds
6. **SADD** `user_sessions:{userId}` with new ID
7. Return `201 { sessionId }`

**Key design:** The Lua invalidation runs BEFORE the new session is created. This guarantees that even under concurrent logins, only one session survives.

---

### `src/routes/leaderboard.js` — Leaderboard Engine

**POST /api/leaderboard/scores:**
- `ZINCRBY leaderboard:global {points} {playerId}` — atomic, single command
- `PUBLISH game-events {...}` — triggers SSE broadcast

**GET /api/leaderboard/top/:count:**
- `ZREVRANGE leaderboard:global 0 count-1 WITHSCORES`
- Maps to `[{ rank, playerId, score }]`

**GET /api/leaderboard/player/:playerId:**
- Pipeline: `ZSCORE + ZREVRANK + ZCARD` (3 commands, 1 round-trip)
- Percentile: `((totalPlayers - rank) / totalPlayers) × 100`
- Nearby window: 2 players above + 2 below via `ZREVRANGE` index slices

---

### `src/routes/game.js` — Atomic Game Logic

**POST /api/game/submit:**
- Calls `EVAL submit_answer.lua` with 3 KEYS + 4 ARGV
- Maps return codes `[0, score]` / `[-1]` / `[-2]` / `[-3]` to HTTP responses
- On success: publishes `score_updated` event

**POST /api/game/rounds (test helper):**
- `HSET game_round:{g}:{r}` with endTime, correctAnswer
- `EXPIREAT` to auto-clean from Redis

---

### `src/routes/events.js` — SSE Fan-Out

**GET /api/events:**
- Sets `Content-Type: text/event-stream`
- Adds `res` object to `sseClients` Set
- Shared subscriber fires `message` event → iterates Set → calls `res.write()`
- Cleans up on `req.on('close')`

**Fan-out efficiency:**
```
N clients = 1 Redis subscriber connection
           (not N connections)
```

---

### `src/routes/admin.js` — Session Administration

**GET /api/admin/sessions/user/:userId:**
- `SMEMBERS user_sessions:{userId}` → list of IDs
- Pipeline `HGETALL` for each ID
- Auto-removes stale IDs (expired TTL means empty hash)

**DELETE /api/admin/sessions/:sessionId:**
- `HGET session:{id} userId` → lookup owner
- Pipeline: `DEL session:{id}` + `SREM user_sessions:{userId} {id}`
- Returns `204 No Content`

---

### `src/scripts/invalidate_sessions.lua`

```lua
-- KEYS[1] = user_sessions:{userId}
local sessions = redis.call('SMEMBERS', KEYS[1])
for _, sid in ipairs(sessions) do
  redis.call('DEL', 'session:' .. sid)
end
if #sessions > 0 then redis.call('DEL', KEYS[1]) end
return #sessions
```

**Why atomic?** SMEMBERS + DEL loop + DEL index must be indivisible.  
Without atomicity, a concurrent session create could add a new ID to the set between SMEMBERS and the final DEL — leaving the new session also deleted.

---

### `src/scripts/submit_answer.lua`

```lua
-- Guard 1: Round exists
local endTime = redis.call('HGET', KEYS[1], 'endTime')
if not endTime then return { -3, 'ROUND_NOT_FOUND' } end

-- Guard 2: Round active
if tonumber(ARGV[3]) > tonumber(endTime) then return { -1, 'ROUND_EXPIRED' } end

-- Guard 3: No duplicate
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return { -2, 'DUPLICATE_SUBMISSION' } end

-- Record + Score
redis.call('SADD', KEYS[2], ARGV[1])
local correct = redis.call('HGET', KEYS[1], 'correctAnswer')
if correct == ARGV[2] then
  return { 0, redis.call('ZINCRBY', KEYS[3], ARGV[4], ARGV[1]) }
else
  return { 0, redis.call('ZSCORE', KEYS[3], ARGV[1]) or '0' }
end
```

---

## 6. Redis Concepts Deep Dive

### 6.1 Hashes

- Store structured objects field-by-field
- Update a single field without reading the whole object: `HSET session:x lastActive now`
- With < 128 fields and short values: `ziplist` encoding (~280 bytes/session)
- Much more memory-efficient than storing serialized JSON strings

### 6.2 Sorted Sets

- Each member has an associated float score
- Automatically maintained in sorted order
- `ZADD` / `ZINCRBY` → O(log N)
- `ZREVRANGE` → O(log N + M)
- `ZREVRANK` → O(log N)
- Perfect for leaderboards, priority queues, rate limiting

### 6.3 Sets

- Unordered collection of unique strings
- `SADD` / `SISMEMBER` → O(1)
- Used for: session index, submission tracking (duplicate prevention)

### 6.4 Pub/Sub

- Fire-and-forget message broadcasting
- Publisher sends to a channel; all subscribers receive
- Does not persist messages (unlike Streams)
- Perfect for ephemeral real-time events

### 6.5 Lua Scripting (EVAL)

- Scripts run atomically on the Redis server
- Access Redis via `redis.call()` — zero network latency between steps
- Return values mapped: Lua table → Redis array, string → bulk string, integer → integer

### 6.6 Pipelines

- Batch multiple commands in one TCP round-trip
- Used in leaderboard player lookup: `ZSCORE + ZREVRANK + ZCARD` → 1 network call
- Does NOT guarantee atomicity (unlike MULTI/EXEC or Lua)

---

## 7. API Contract Reference

### Sessions

| Method | Path | Status | Body In | Body Out |
|---|---|---|---|---|
| POST | `/api/sessions` | 201 | `{userId, ipAddress, deviceType}` | `{sessionId}` |

### Leaderboard

| Method | Path | Status | Body/Params | Body Out |
|---|---|---|---|---|
| POST | `/api/leaderboard/scores` | 200 | `{playerId, points}` | `{playerId, newScore}` |
| GET | `/api/leaderboard/top/:count` | 200 | `:count` | `[{rank, playerId, score}]` |
| GET | `/api/leaderboard/player/:playerId` | 200 | `:playerId` | `{playerId, score, rank, percentile, nearbyPlayers}` |

### Game

| Method | Path | Status | Body | Body Out |
|---|---|---|---|---|
| POST | `/api/game/rounds` | 201 | `{gameId, roundId, correctAnswer, durationSeconds}` | `{gameId, roundId, endTime}` |
| POST | `/api/game/submit` | 200/400/403 | `{gameId, roundId, playerId, answer}` | `{status, newScore}` or `{status, code}` |

### Events

| Method | Path | Content-Type | Description |
|---|---|---|---|
| GET | `/api/events` | `text/event-stream` | SSE stream of game events |

### Admin

| Method | Path | Status | Description |
|---|---|---|---|
| GET | `/api/admin/sessions/user/:userId` | 200 | List all sessions for user |
| DELETE | `/api/admin/sessions/:sessionId` | 204 | Delete a specific session |

---

## 8. Lua Script Internals

### Why Not MULTI/EXEC (Optimistic Transactions)?

```
MULTI/EXEC approach:
  WATCH user_sessions:userId
  MULTI
    SMEMBERS user_sessions:userId   ← Can't use result inside MULTI block!
    DEL session:sid1                ← Must know sid1 beforehand
    DEL session:sid2
  EXEC

Problem: You cannot use the result of SMEMBERS to decide which keys to DEL
         within the same MULTI/EXEC block. You'd need a client-side round-trip,
         breaking atomicity.

Lua EVAL approach:
  The script reads SMEMBERS and immediately uses the result to call DEL.
  All within the same atomic server-side execution.
```

### EVAL Syntax

```javascript
await publisher.eval(
  luaScriptString,   // Script source
  numkeys,           // Number of KEYS arguments
  ...keys,           // KEYS[1], KEYS[2], ...
  ...args            // ARGV[1], ARGV[2], ...
);
```

### Return Value Mapping

```
Lua nil      → Redis nil reply
Lua boolean  → Redis integer (true=1, false=0)
Lua integer  → Redis integer
Lua float    → Redis bulk string (use tostring())
Lua string   → Redis bulk string
Lua table    → Redis array (recursive)
```

---

## 9. Setup & Installation

### Local Development (with Docker)

```bash
# 1. Clone
git clone https://github.com/ramalokeshreddyp/AtomicRank.git
cd AtomicRank

# 2. Environment
cp .env.example .env

# 3. Start
docker-compose up --build

# 4. Seed data
docker-compose exec api node src/seed.js

# 5. Dashboard
open http://localhost:3000
```

### Local Development (without Docker)

```bash
# Requires: Node.js 20+, Redis 7 running locally

npm install
REDIS_URL=redis://localhost:6379 API_PORT=3000 node src/index.js
```

### Environment Variables

```env
REDIS_URL=redis://redis:6379          # Redis connection string
API_PORT=3000                          # API server port
NODE_ENV=production                    # Node environment
SESSION_TTL=1800                       # Session expiry (seconds)
CORRECT_ANSWER_POINTS=10               # Points per correct answer
```

### Directory Structure After Setup

```
AtomicRank/
├── .env                 ← Created from .env.example (gitignored)
├── node_modules/        ← Created by npm install (gitignored)
└── ... (all source files)
```

---

## 10. Testing Strategy

### 10.1 Manual API Testing

```bash
BASE="http://localhost:3000"

# Health check
curl $BASE/health

# Create 3 sessions for same user (first 2 should be invalidated)
for i in 1 2 3; do
  curl -s -X POST $BASE/api/sessions \
    -H "Content-Type: application/json" \
    -d "{\"userId\":\"u1\",\"ipAddress\":\"1.1.1.$i\",\"deviceType\":\"desktop\"}"
done

# Verify only 1 session remains
curl $BASE/api/admin/sessions/user/u1 | python3 -m json.tool

# Submit scores
curl -X POST $BASE/api/leaderboard/scores \
  -H "Content-Type: application/json" \
  -d '{"playerId":"p1","points":50}'

# Player rank
curl "$BASE/api/leaderboard/player/p1"
```

### 10.2 Redis Direct Verification

```bash
docker-compose exec redis redis-cli

# Session hash
HGETALL session:<sessionId>
TTL session:<sessionId>         # Must be > 1700

# Session index
SMEMBERS user_sessions:u1      # Must contain exactly 1 ID

# Leaderboard
ZSCORE leaderboard:global p1   # Must match API response
ZREVRANK leaderboard:global p1 # 0-indexed rank

# Memory analysis
MEMORY USAGE leaderboard:global
OBJECT ENCODING leaderboard:global
```

### 10.3 SSE Testing

```bash
# Terminal 1: Connect SSE stream
curl -N http://localhost:3000/api/events

# Terminal 2: Submit a score (should appear in Terminal 1 within 2s)
curl -X POST http://localhost:3000/api/leaderboard/scores \
  -H "Content-Type: application/json" \
  -d '{"playerId":"sse-test","points":100}'
```

### 10.4 Concurrent Safety Test

```bash
# Submit same answer 10 times in parallel
for i in $(seq 1 10); do
  curl -s -X POST http://localhost:3000/api/game/submit \
    -H "Content-Type: application/json" \
    -d '{"gameId":"g1","roundId":"r1","playerId":"concurrent-player","answer":"Paris"}' &
done
wait

# Verify score incremented exactly once (= 10 points, not 100)
curl -s http://localhost:3000/api/leaderboard/player/concurrent-player | grep score
```

### 10.5 Verification Checklist

| Requirement | Verification Step | Expected |
|---|---|---|
| Session TTL | `TTL session:{id}` | > 1700 |
| Lua invalidation | Create 3 sessions, check admin | 1 session remains |
| Score atomicity | Submit 50, then 25 | newScore = 75 |
| Top-N sorted | `GET /api/leaderboard/top/10` | Descending order |
| Percentile | Player at rank 15 of 35 | ~57% |
| Nearby window | Same player | 2 above, 2 below |
| Duplicate submit | Same player, same round twice | 400 DUPLICATE_SUBMISSION |
| Expired round | Submit to 1-sec round after wait | 403 ROUND_EXPIRED |
| SSE delivery | Submit score, check SSE stream | Event within 2s |
| Admin delete | Delete session, check Redis | Key gone, Set cleaned |

---

## 11. Pros, Cons & Trade-offs

### Pros

| Pro | Detail |
|---|---|
| **Sub-millisecond leaderboard** | Redis Sorted Set in-memory operations |
| **Zero race conditions** | Lua EVAL atomicity guaranteed by Redis |
| **Minimal code** | ZINCRBY replaces a read-modify-write Lua script |
| **Live updates** | Pub/Sub → SSE pipeline with no polling |
| **One-command deploy** | docker-compose up — no manual steps |
| **Memory efficient** | ziplist encoding for small structures |
| **Horizontally scalable API** | Stateless Express servers share Redis |

### Cons

| Con | Detail |
|---|---|
| **Redis single point of failure** | Without Sentinel/Cluster, Redis outage = full outage |
| **Data loss on crash** | Default Redis is in-memory; persistence needs AOF/RDB config |
| **Lua script complexity** | Harder to debug than regular application code |
| **SSE per-instance** | Cross-instance SSE requires sticky sessions at LB |
| **No authentication** | API endpoints are open — auth layer not implemented |

### Trade-offs

| Decision | Pro | Con |
|---|---|---|
| Vanilla JS frontend | Zero build step | No component reuse, harder state management |
| Single Redis node | Simple, fast setup | No HA without Sentinel |
| No JWT auth | Simpler implementation | Not production-secure as-is |
| Pub/Sub (not Streams) | Simple, low latency | No message persistence/replay |

---

## 12. Advantages & Benefits

### For Gaming Applications

- **Leaderboard at scale:** 1M players ranked in O(log N) per query
- **Cheat prevention:** Lua script duplicate-submission guard is race-condition-proof
- **Fairness:** Round expiry checked server-side atomically — client clock manipulation irrelevant
- **Live experience:** Score changes appear on all dashboards within 2 seconds

### For the Engineering Team

- **Redis mastery:** Covers 5 Redis data structures + Lua + Pub/Sub
- **Concurrency patterns:** Teaches TOCTOU problems and their solution
- **Container literacy:** Full Docker Compose workflow with health checks
- **SSE pattern:** Efficient fan-out without WebSocket overhead

### Performance Characteristics

```
Operation                  | Latency  | Complexity
---------------------------+----------+-----------
Session create (with Lua)  | ~2ms     | O(N) sessions
Score update (ZINCRBY)     | ~0.5ms   | O(log N)
Top 10 leaderboard         | ~0.5ms   | O(log N + 10)
Player rank lookup         | ~1ms     | O(log N) × 3 pipelined
Game submit (Lua)          | ~1.5ms   | O(log N)
SSE event delivery         | ~5-50ms  | O(clients)

N = number of players in leaderboard
```

---

## 13. Known Limitations

1. **No persistence configuration** — Redis data lost on container restart without volume mounts
2. **No authentication** — All API endpoints are publicly accessible
3. **SSE not cross-instance** — Multiple API replicas require sticky sessions
4. **Pub/Sub fire-and-forget** — Events not stored; late-connecting SSE clients miss past events
5. **No rate limiting** — Score endpoint can be called unlimited times
6. **Lua script error handling** — Redis Lua errors return as Node.js exceptions, not structured responses

---

## 14. Future Roadmap

| Enhancement | Priority | Description |
|---|---|---|
| Redis Persistence | High | Enable AOF with `appendonly yes` for durability |
| JWT Authentication | High | Protect all endpoints with bearer tokens |
| Redis Sentinel | Medium | Automatic failover for high availability |
| Rate Limiting | Medium | Sliding window rate limiter using Redis |
| Event Replay | Medium | Redis Streams instead of Pub/Sub for replay |
| WebSocket Option | Low | Bidirectional communication for game rooms |
| Leaderboard Snapshots | Low | Periodic leaderboard archival to PostgreSQL |
| Prometheus Metrics | Low | Expose `/metrics` for Grafana monitoring |

---

*QuizArena — Demonstrating production-grade Redis patterns for real-time gaming.*  
*Built by [ramalokeshreddyp](https://github.com/ramalokeshreddyp)*
