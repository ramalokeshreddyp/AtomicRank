--[[
  invalidate_sessions.lua
  ========================
  Atomically invalidates all existing Redis sessions for a given user
  BEFORE creating a new one. This prevents session accumulation and
  ensures only one active session per user at any time.

  KEYS:
    KEYS[1] = user_sessions:{userId}   — Redis Set of active session IDs

  ARGV:
    ARGV[1] = (unused, reserved for future use)

  Returns:
    integer — number of sessions invalidated

  Why Lua?
  ---------
  Without atomicity, a race condition exists:
    1. Client A reads SMEMBERS (gets [sid1, sid2])
    2. Client B creates a new session (adds sid3)
    3. Client A deletes [sid1, sid2] only — sid3 survives unintentionally
  By running inside a single EVAL, Redis serialises this entire block.
]]

local userSessionsKey = KEYS[1]

-- Retrieve all current session IDs for this user
local sessions = redis.call('SMEMBERS', userSessionsKey)
local count = #sessions

-- Delete each session Hash
for _, sid in ipairs(sessions) do
  redis.call('DEL', 'session:' .. sid)
end

-- Clear the sessions index Set
if count > 0 then
  redis.call('DEL', userSessionsKey)
end

return count
