<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=32&duration=2800&pause=2000&color=7C3AED&center=true&vCenter=true&width=940&lines=⚡+QuizArena+%7C+Redis-Powered+Game+Leaderboard;Real-Time+%7C+Atomic+%7C+Production-Ready" alt="Typing SVG" />

<br/>

[![Redis](https://img.shields.io/badge/Redis-7.x-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io)
[![Node.js](https://img.shields.io/badge/Node.js-20_LTS-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express.js](https://img.shields.io/badge/Express.js-4.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-7C3AED?style=for-the-badge)](LICENSE)

<br/>

> **A high-performance, production-ready backend for a real-time competitive quiz game.**  
> Powered by advanced Redis data structures, atomic Lua scripts, and live Server-Sent Events.

<br/>

[🚀 Quick Start](#-quick-start) · [📐 Architecture](#-system-architecture) · [📡 API Reference](#-api-reference) · [🔬 Lua Scripts](#-lua-scripts--atomicity) · [🧪 Testing](#-testing--verification)

---

</div>

## 📋 Table of Contents

- [✨ Project Overview](#-project-overview)
- [🛠 Tech Stack](#-tech-stack)
- [📁 Folder Structure](#-folder-structure)
- [📐 System Architecture](#-system-architecture)
- [🔄 Execution Flow](#-execution-flow)
- [🗃️ Redis Key Schema](#️-redis-key-schema)
- [🚀 Quick Start](#-quick-start)
- [⚙️ Configuration](#️-configuration)
- [📡 API Reference](#-api-reference)
- [🔬 Lua Scripts & Atomicity](#-lua-scripts--atomicity)
- [📡 Real-Time Events (SSE)](#-real-time-events-sse)
- [🎮 Frontend Dashboard](#-frontend-dashboard)
- [🧪 Testing & Verification](#-testing--verification)
- [📊 Memory Analysis](#-memory-analysis)

---

## ✨ Project Overview

**QuizArena** is a backend infrastructure for a competitive, real-time quiz game platform. It demonstrates how Redis — far beyond a simple cache — can serve as a powerful, low-latency data structure server for gaming applications.

<div align="center">

| Feature | Implementation |
|---|---|
| 🏆 **Real-Time Leaderboard** | Redis Sorted Sets (ZINCRBY, ZREVRANGE) |
| 🔐 **Session Management** | Redis Hashes with sliding 30-min TTL |
| ⚡ **Atomic Game Logic** | Lua scripts via EVAL |
| 📡 **Live Score Updates** | Redis Pub/Sub → Server-Sent Events |
| 🛡️ **Race Condition Safety** | Lua atomicity eliminates all TOCTOU bugs |
| 🐳 **One-Command Deploy** | Docker Compose |

</div>

---

## 🛠 Tech Stack

<div align="center">

| Layer | Technology | Purpose |
|---|---|---|
| **Runtime** | Node.js 20 LTS | Async I/O, excellent Redis ecosystem |
| **Framework** | Express.js 4.x | REST API + SSE endpoints |
| **Redis Client** | ioredis 5.x | Pipelines, Lua EVAL, Pub/Sub |
| **Database** | Redis 7 (Alpine) | In-memory data structures |
| **Containerization** | Docker + Compose | Reproducible single-command environment |
| **Frontend** | Vanilla HTML/CSS/JS | Zero-dependency live dashboard |
| **ID Generation** | uuid v4 | Cryptographically random session IDs |

</div>

### Why Redis over a Relational DB?

```
Relational DB query path:
  Client → Network → DB Server → Disk I/O → Parse SQL → Lock rows → Return → Network
  Typical latency: 5–50ms per query

Redis operation path:
  Client → Network → In-memory data structure → Return
  Typical latency: 0.1–1ms per operation
```

For a leaderboard with 1M players, `ZREVRANK` runs in **O(log N)** — roughly 20 comparisons — regardless of data size.

---

## 📁 Folder Structure

```
AtomicRank/
│
├── 📄 docker-compose.yml          # Orchestrates api + redis services
├── 📄 Dockerfile                  # Multi-stage Node.js 20 Alpine build
├── 📄 .env.example                # Environment variable template
├── 📄 .gitignore                  # Excludes .env, node_modules
├── 📄 package.json                # Dependencies and scripts
├── 📄 submission.json             # Evaluator configuration
├── 📄 MEMORY_ANALYSIS.md          # Redis memory encoding analysis
├── 📄 README.md                   # This file
├── 📄 architecture.md             # System architecture documentation
├── 📄 projectdocumentation.md     # Full project documentation
│
├── 📂 src/
│   ├── 📄 index.js                # Express app entry point + /health
│   │
│   ├── 📂 config/
│   │   └── 📄 redis.js            # Publisher + Subscriber Redis clients
│   │
│   ├── 📂 routes/
│   │   ├── 📄 sessions.js         # POST /api/sessions
│   │   ├── 📄 leaderboard.js      # Score submission + leaderboard queries
│   │   ├── 📄 game.js             # POST /api/game/submit (Lua)
│   │   ├── 📄 events.js           # GET /api/events (SSE)
│   │   └── 📄 admin.js            # Admin session management
│   │
│   ├── 📂 scripts/
│   │   ├── 📄 invalidate_sessions.lua   # Atomic session cleanup
│   │   └── 📄 submit_answer.lua         # Atomic game answer processing
│   │
│   ├── 📂 middleware/
│   │   └── 📄 errorHandler.js     # Centralised error handling
│   │
│   └── 📄 seed.js                 # Data seeding utility
│
└── 📂 public/
    ├── 📄 index.html              # Dashboard SPA entry point
    ├── 📄 style.css               # Dark glassmorphism design system
    └── 📄 app.js                  # Frontend application logic
```

---

## 📐 System Architecture

### High-Level Overview

```mermaid
graph TB
    subgraph Browser["🌐 Browser Client"]
        Dashboard["📊 Dashboard SPA<br/>(Vanilla JS)"]
    end

    subgraph API["🖥️ API Server (Express.js)"]
        Health["/health"]
        Sessions["/api/sessions"]
        Leaderboard["/api/leaderboard"]
        Game["/api/game/submit"]
        Events["/api/events · SSE"]
        Admin["/api/admin"]
    end

    subgraph Redis["🔴 Redis 7"]
        Hashes["📦 Hashes<br/>session:{id}"]
        SortedSets["📈 Sorted Sets<br/>leaderboard:global"]
        Sets["🔗 Sets<br/>user_sessions:{userId}<br/>submissions:{gameId}:{roundId}"]
        PubSub["📡 Pub/Sub<br/>game-events channel"]
    end

    Dashboard -->|REST API calls| API
    Dashboard -->|SSE connection| Events
    Sessions -->|HSET + EVAL Lua| Hashes
    Sessions -->|SADD| Sets
    Leaderboard -->|ZINCRBY| SortedSets
    Leaderboard -->|PUBLISH| PubSub
    Game -->|EVAL Lua| SortedSets
    Game -->|EVAL Lua| Sets
    Admin -->|HGETALL + DEL| Hashes
    Events -->|SUBSCRIBE| PubSub
    PubSub -->|Fan-out| Events

    style Browser fill:#1a1d2e,stroke:#7c3aed,color:#e8eaf0
    style API fill:#0f1219,stroke:#06b6d4,color:#e8eaf0
    style Redis fill:#1a0a0a,stroke:#DC382D,color:#e8eaf0
```

### Two-Connection Redis Pattern

```mermaid
graph LR
    subgraph App["Express App"]
        Routes["API Routes"]
        SSE["SSE Handler"]
    end

    subgraph Redis["Redis Server"]
        Commands["Command Processing"]
        Channel["game-events channel"]
    end

    Publisher["publisher<br/>(ioredis)"]
    Subscriber["subscriber<br/>(ioredis)"]

    Routes -->|HSET, ZINCRBY,<br/>EVAL, PUBLISH| Publisher
    Publisher --> Commands
    Publisher -->|PUBLISH| Channel

    Channel -->|message| Subscriber
    Subscriber -->|fan-out| SSE
    SSE -->|text/event-stream| Clients["Browser Clients (N)"]

    style Publisher fill:#7c3aed,color:white
    style Subscriber fill:#06b6d4,color:white
    style Channel fill:#DC382D,color:white
```

> **Why two connections?**  
> Once `SUBSCRIBE` is called on an ioredis connection, it enters dedicated Pub/Sub mode and cannot process regular commands. The `publisher` handles all read/write commands; the `subscriber` handles all incoming Pub/Sub messages.

---

## 🔄 Execution Flow

### Session Creation Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant API as Express API
    participant Lua as Redis Lua VM
    participant R as Redis

    C->>API: POST /api/sessions<br/>{userId, ipAddress, deviceType}
    API->>Lua: EVAL invalidate_sessions.lua<br/>KEYS[1] = user_sessions:{userId}
    Lua->>R: SMEMBERS user_sessions:{userId}
    R-->>Lua: [sid1, sid2, ...]
    Lua->>R: DEL session:sid1
    Lua->>R: DEL session:sid2
    Lua->>R: DEL user_sessions:{userId}
    Lua-->>API: {count: 2 deleted}
    API->>R: HSET session:{newId} {userId, ip, device, timestamps}
    API->>R: EXPIRE session:{newId} 1800
    API->>R: SADD user_sessions:{userId} {newId}
    API-->>C: 201 { sessionId: newId }
```

### Score Submission & Live Update Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant API as Express API
    participant R as Redis
    participant Sub as SSE Subscriber
    participant B as Browser (SSE)

    C->>API: POST /api/leaderboard/scores<br/>{playerId, points}
    API->>R: ZINCRBY leaderboard:global {points} {playerId}
    R-->>API: newScore (e.g. 75)
    API->>R: PUBLISH game-events<br/>{"event":"leaderboard_updated","data":{...}}
    API-->>C: 200 { playerId, newScore: 75 }

    R-->>Sub: message on game-events
    Sub->>B: event: leaderboard_updated\ndata: {"playerId":"...","newScore":75}\n\n
    Note over B: Dashboard auto-refreshes leaderboard
```

### Atomic Game Answer Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant API as Express API
    participant Lua as Redis Lua VM
    participant R as Redis

    C->>API: POST /api/game/submit<br/>{gameId, roundId, playerId, answer}
    API->>Lua: EVAL submit_answer.lua<br/>KEYS[1..3], ARGV[1..4]

    Lua->>R: HGET game_round:{g}:{r} endTime
    R-->>Lua: endTime value

    alt currentTime > endTime
        Lua-->>API: [-1, "ROUND_EXPIRED"]
        API-->>C: 403 { code: "ROUND_EXPIRED" }
    else Round active
        Lua->>R: SISMEMBER submissions:{g}:{r} {playerId}
        R-->>Lua: 0 or 1

        alt Already submitted
            Lua-->>API: [-2, "DUPLICATE_SUBMISSION"]
            API-->>C: 400 { code: "DUPLICATE_SUBMISSION" }
        else First submission
            Lua->>R: SADD submissions:{g}:{r} {playerId}
            Lua->>R: HGET game_round:{g}:{r} correctAnswer
            R-->>Lua: correctAnswer

            alt Correct answer
                Lua->>R: ZINCRBY leaderboard:global 10 {playerId}
                R-->>Lua: newScore
            else Wrong answer
                Lua->>R: ZSCORE leaderboard:global {playerId}
                R-->>Lua: currentScore
            end

            Lua-->>API: [0, newScore]
            API-->>C: 200 { status: "SUCCESS", newScore }
        end
    end
```

---

## 🗃️ Redis Key Schema

```mermaid
erDiagram
    SESSION_HASH {
        string userId
        string createdAt
        string lastActive
        string ipAddress
        string deviceType
    }

    USER_SESSIONS_SET {
        string sessionId_1
        string sessionId_2
    }

    LEADERBOARD_SORTED_SET {
        float score
        string playerId
    }

    GAME_ROUND_HASH {
        string gameId
        string roundId
        string correctAnswer
        string endTime
        string createdAt
    }

    SUBMISSIONS_SET {
        string playerId_1
        string playerId_2
    }

    SESSION_HASH ||--o{ USER_SESSIONS_SET : "indexed by"
    LEADERBOARD_SORTED_SET ||--o{ SUBMISSIONS_SET : "players tracked by"
    GAME_ROUND_HASH ||--|| SUBMISSIONS_SET : "has"
```

| Key Pattern | Redis Type | TTL | Description |
|---|---|---|---|
| `session:{sessionId}` | Hash | 1800s | Per-session data |
| `user_sessions:{userId}` | Set | None | Index of active sessions |
| `leaderboard:global` | Sorted Set | None | All player scores |
| `leaderboard:game:{gameId}` | Sorted Set | None | Per-game scores |
| `game_round:{gameId}:{roundId}` | Hash | 3600s after end | Round metadata |
| `submissions:{gameId}:{roundId}` | Set | Inherits | Submitted player IDs |

---

## 🚀 Quick Start

### Prerequisites

- Docker ≥ 24.x
- Docker Compose ≥ 2.x

### 1. Clone the Repository

```bash
git clone https://github.com/ramalokeshreddyp/AtomicRank.git
cd AtomicRank
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env if needed (defaults work out of the box)
```

### 3. Start All Services

```bash
docker-compose up --build
```

That's it. The system self-starts, performs health checks, and is ready in ~30 seconds.

```
quiz_redis  | Ready to accept connections tcp
quiz_api    | [Redis Publisher] Ready
quiz_api    | [Redis Subscriber] Ready
quiz_api    | [API] Server listening on port 3000
quiz_api    | [API] Dashboard: http://localhost:3000/
```

### 4. Verify Health

```bash
curl http://localhost:3000/health
# → { "status": "OK", "redis": "connected" }
```

### 5. Open the Dashboard

Navigate to **http://localhost:3000** in your browser.

---

## ⚙️ Configuration

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `API_PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `production` | Node environment |
| `SESSION_TTL` | `1800` | Session TTL in seconds |
| `CORRECT_ANSWER_POINTS` | `10` | Points for a correct quiz answer |

---

## 📡 API Reference

### Session Management

```http
POST /api/sessions
Content-Type: application/json

{
  "userId": "user-42",
  "ipAddress": "192.168.1.1",
  "deviceType": "desktop"
}

# Response 201
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000" }
```

> ⚡ **Atomically invalidates** all existing sessions for the same `userId` via Lua before creating the new one.

---

### Leaderboard

```http
POST /api/leaderboard/scores
{ "playerId": "player-alpha", "points": 50 }
# → 200 { "playerId": "player-alpha", "newScore": 75 }

GET /api/leaderboard/top/10
# → [ { "rank": 1, "playerId": "...", "score": 500 }, ... ]

GET /api/leaderboard/player/player-alpha
# → { "playerId": "...", "score": 75, "rank": 2, "percentile": 94.3,
#     "nearbyPlayers": { "above": [...], "below": [...] } }
```

---

### Game

```http
POST /api/game/rounds
{ "gameId": "g1", "roundId": "r1", "correctAnswer": "Paris", "durationSeconds": 300 }

POST /api/game/submit
{ "gameId": "g1", "roundId": "r1", "playerId": "player-alpha", "answer": "Paris" }
# Success  → 200 { "status": "SUCCESS", "newScore": 85 }
# Duplicate→ 400 { "status": "ERROR", "code": "DUPLICATE_SUBMISSION" }
# Expired  → 403 { "status": "ERROR", "code": "ROUND_EXPIRED" }
```

---

### SSE — Real-Time Events

```http
GET /api/events
Accept: text/event-stream

# Events received:
event: connected
data: {"message":"SSE stream connected"}

event: leaderboard_updated
data: {"playerId":"player-alpha","newScore":75}

event: score_updated
data: {"playerId":"player-alpha","newScore":85,"gameId":"g1","roundId":"r1"}
```

---

### Admin

```http
GET  /api/admin/sessions/user/{userId}   → [ { sessionId, ipAddress, lastActive, deviceType } ]
DELETE /api/admin/sessions/{sessionId}   → 204 No Content
```

---

## 🔬 Lua Scripts & Atomicity

### The Core Problem: Race Conditions

Without atomicity, concurrent requests create dangerous gaps:

```
Thread A: SMEMBERS user_sessions → [sid1, sid2]   ← reads old sessions
Thread B: SMEMBERS user_sessions → [sid1, sid2]   ← reads same set (gap!)
Thread A: DEL session:sid1, DEL session:sid2        ← cleans up
Thread A: SADD user_sessions sid3                  ← adds new session
Thread B: SADD user_sessions sid4                  ← BUG: two active sessions!
```

### The Solution: EVAL Atomicity

Redis executes Lua scripts in a single atomic block. No other command can interleave.

### `invalidate_sessions.lua`

```lua
local sessions = redis.call('SMEMBERS', KEYS[1])
for _, sid in ipairs(sessions) do
  redis.call('DEL', 'session:' .. sid)    -- delete each session hash
end
if #sessions > 0 then
  redis.call('DEL', KEYS[1])             -- clear the index set
end
return #sessions
```

**Guarantees:** Reading sessions + deleting them + clearing the index is one indivisible operation.

### `submit_answer.lua` — 6 Redis Commands, 1 Atomic Block

```mermaid
flowchart TD
    A([EVAL submit_answer.lua]) --> B{HGET endTime}
    B -->|not found| C[return -3 ROUND_NOT_FOUND]
    B -->|found| D{currentTime > endTime?}
    D -->|yes| E[return -1 ROUND_EXPIRED]
    D -->|no| F{SISMEMBER submissions playerId}
    F -->|1 = already submitted| G[return -2 DUPLICATE_SUBMISSION]
    F -->|0 = first submission| H[SADD submissions playerId]
    H --> I{HGET correctAnswer == answer?}
    I -->|correct| J[ZINCRBY leaderboard +10 playerId]
    I -->|wrong| K[ZSCORE leaderboard playerId]
    J --> L[return 0, newScore]
    K --> L

    style A fill:#7c3aed,color:white
    style C fill:#ef4444,color:white
    style E fill:#ef4444,color:white
    style G fill:#ef4444,color:white
    style L fill:#10b981,color:white
```

---

## 📡 Real-Time Events (SSE)

### SSE Fan-Out Architecture

```mermaid
graph LR
    Score["POST /api/leaderboard/scores"]
    -->|PUBLISH game-events| Redis[("Redis\nPub/Sub")]

    Redis -->|message| SharedSub["Shared SSE Subscriber\n(1 Redis connection)"]

    SharedSub -->|write| C1["Browser 1"]
    SharedSub -->|write| C2["Browser 2"]
    SharedSub -->|write| C3["Browser 3 ... N"]

    style SharedSub fill:#06b6d4,color:white
    style Redis fill:#DC382D,color:white
```

**Key design:** One shared Redis subscriber feeds unlimited browser clients. This avoids **N Redis connections for N browser tabs**.

---

## 🎮 Frontend Dashboard

The dashboard is a fully interactive single-page application:

| Tab | Features |
|---|---|
| 🏆 **Leaderboard** | Live-updating table, score bars, seed demo data, submit scores |
| 🎮 **Game Control** | Create rounds, submit answers, see real-time results |
| 🔐 **Sessions** | Create and manage user sessions, revoke individual sessions |
| 📡 **Live Events** | Real-time SSE event feed with auto-refresh |

---

## 🧪 Testing & Verification

### Full End-to-End Verification

```bash
# Run all tests against live containers
BASE="http://localhost:3000"

# Health
curl $BASE/health

# Create session (Lua invalidation)
curl -X POST $BASE/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-1","ipAddress":"1.1.1.1","deviceType":"desktop"}'

# Submit score
curl -X POST $BASE/api/leaderboard/scores \
  -H "Content-Type: application/json" \
  -d '{"playerId":"player-alpha","points":50}'

# Top 10
curl $BASE/api/leaderboard/top/10

# Player rank
curl $BASE/api/leaderboard/player/player-alpha

# Create game round
curl -X POST $BASE/api/game/rounds \
  -H "Content-Type: application/json" \
  -d '{"gameId":"g1","roundId":"r1","correctAnswer":"Redis","durationSeconds":300}'

# Submit answer
curl -X POST $BASE/api/game/submit \
  -H "Content-Type: application/json" \
  -d '{"gameId":"g1","roundId":"r1","playerId":"player-alpha","answer":"Redis"}'

# SSE stream (keep alive, submit score in another terminal to see event)
curl -N $BASE/api/events
```

### Redis State Inspection

```bash
# Connect to Redis inside Docker
docker-compose exec redis redis-cli

# Check session hash
HGETALL session:{sessionId}

# Check TTL
TTL session:{sessionId}

# Check leaderboard
ZREVRANGE leaderboard:global 0 9 WITHSCORES

# Check player rank
ZREVRANK leaderboard:global player-alpha

# Check memory
MEMORY USAGE leaderboard:global
OBJECT ENCODING leaderboard:global
```

### Seed Data

```bash
# Seed 35 players + game rounds
docker-compose exec api node src/seed.js
```

---

## 📊 Memory Analysis

From `MEMORY_ANALYSIS.md`:

| Structure | Encoding | Memory |
|---|---|---|
| Session Hash (5 fields) | `ziplist` | ~280 bytes |
| Leaderboard (50 players) | `ziplist` | ~3.2 KB |
| Leaderboard (50 players, forced skiplist) | `skiplist` | ~8.1 KB |
| Leaderboard (100,000 players) | `skiplist` | ~19.4 MB |

**Takeaway:** A leaderboard with 1 million players fits in under **200 MB** of Redis memory.

---

<div align="center">

### Built with ⚡ by [ramalokeshreddyp](https://github.com/ramalokeshreddyp)

[![GitHub](https://img.shields.io/badge/GitHub-ramalokeshreddyp-7C3AED?style=for-the-badge&logo=github)](https://github.com/ramalokeshreddyp/AtomicRank)

*QuizArena — Where every millisecond counts.*

</div>
