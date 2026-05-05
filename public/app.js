/* ============================================================
   QuizArena — Frontend Application
   Handles tab navigation, SSE stream, API calls, and UI updates
   ============================================================ */

'use strict';

// ── Configuration ─────────────────────────────────────────────────
const BASE_URL = '';          // Same origin
const SSE_URL  = '/api/events';

// ── State ─────────────────────────────────────────────────────────
let eventSource = null;
let eventCount  = 0;
let topScoreForBar = 1;       // Used to normalise score bars

// ── Utility: API fetch wrapper ─────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(BASE_URL + path, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, data: json };
}

// ── Toast notifications ────────────────────────────────────────────
function toast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

// ── Tab Navigation ─────────────────────────────────────────────────
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;

      // Update tab buttons
      tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      // Show/hide sections
      document.querySelectorAll('.tab-section').forEach(sec => sec.classList.add('hidden'));
      document.getElementById(`section-${name}`).classList.remove('hidden');
    });
  });
}

// ── SSE Connection ─────────────────────────────────────────────────
function initSSE() {
  const dot   = document.getElementById('status-dot');
  const label = document.getElementById('status-label');

  function connect() {
    if (eventSource) { eventSource.close(); }

    eventSource = new EventSource(SSE_URL);

    eventSource.addEventListener('connected', () => {
      dot.className = 'status-dot connected';
      label.textContent = 'Live';
    });

    // Generic message handler
    eventSource.onmessage = (e) => handleEvent('message', e.data);

    // Named event listeners
    ['leaderboard_updated', 'score_updated', 'connected'].forEach(evtName => {
      eventSource.addEventListener(evtName, (e) => handleEvent(evtName, e.data));
    });

    eventSource.onerror = () => {
      dot.className = 'status-dot error';
      label.textContent = 'Reconnecting…';
      // EventSource auto-reconnects; just update UI
    };
  }

  connect();
}

function handleEvent(eventName, rawData) {
  let data = rawData;
  try { data = JSON.parse(rawData); } catch {}

  // Update event feed
  appendEventToFeed(eventName, data);

  // Auto-refresh leaderboard on score events
  if (eventName === 'leaderboard_updated' || eventName === 'score_updated') {
    refreshLeaderboard(true); // silent refresh
  }
}

// ── Event Feed ─────────────────────────────────────────────────────
function appendEventToFeed(eventName, data) {
  const feed = document.getElementById('events-feed');

  // Remove placeholder
  const placeholder = feed.querySelector('.event-placeholder');
  if (placeholder) placeholder.remove();

  eventCount++;
  document.getElementById('event-count-badge').textContent = eventCount;

  const icons = {
    leaderboard_updated: '📊',
    score_updated: '⬆️',
    connected: '🔗',
    message: '📨',
  };

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const item = document.createElement('div');
  item.className = `event-item ev-${eventName}`;
  item.innerHTML = `
    <span class="event-time">${timeStr}</span>
    <div class="event-body">
      <div class="event-type">${eventName}</div>
      <div class="event-data">${typeof data === 'object' ? JSON.stringify(data, null, 0) : data}</div>
    </div>
    <span class="event-icon" aria-hidden="true">${icons[eventName] || '📩'}</span>
  `;

  feed.insertBefore(item, feed.firstChild); // newest first
}

document.getElementById('btn-clear-events').addEventListener('click', () => {
  const feed = document.getElementById('events-feed');
  feed.innerHTML = `
    <div class="event-placeholder">
      <span class="placeholder-icon" aria-hidden="true">📭</span>
      <p>Feed cleared. Waiting for new events…</p>
    </div>`;
  eventCount = 0;
  document.getElementById('event-count-badge').textContent = '0';
});

// ── Leaderboard ────────────────────────────────────────────────────
async function refreshLeaderboard(silent = false) {
  const count = parseInt(document.getElementById('top-count-select').value, 10);
  const { ok, data } = await api('GET', `/api/leaderboard/top/${count}`);

  if (!ok) {
    if (!silent) toast('Failed to load leaderboard', 'error');
    return;
  }

  topScoreForBar = data.length > 0 ? data[0].score : 1;
  renderLeaderboard(data);
  document.getElementById('lb-count-badge').textContent = `${data.length} players`;
}

function renderLeaderboard(players) {
  const tbody = document.getElementById('leaderboard-body');

  if (!players || players.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No players yet. Submit some scores to get started! 🎮</td></tr>`;
    return;
  }

  const rankMedals = { 1: '🥇', 2: '🥈', 3: '🥉' };

  tbody.innerHTML = players.map(p => {
    const rankClass = p.rank <= 3 ? `rank-${p.rank}` : '';
    const medal     = rankMedals[p.rank] ? `<span class="rank-medal">${rankMedals[p.rank]}</span>` : '';
    const barWidth  = Math.max(2, Math.round((p.score / Math.max(topScoreForBar, 1)) * 100));

    return `<tr>
      <td class="rank-cell ${rankClass}">${medal || `#${p.rank}`}</td>
      <td class="player-id-cell">${escHtml(p.playerId)}</td>
      <td class="score-cell">${p.score.toLocaleString()}</td>
      <td><div class="score-bar-wrap"><div class="score-bar" style="width:${barWidth}%"></div></div></td>
    </tr>`;
  }).join('');
}

document.getElementById('btn-refresh-lb').addEventListener('click', () => refreshLeaderboard());
document.getElementById('top-count-select').addEventListener('change', () => refreshLeaderboard());

// ── Seed Demo Data ─────────────────────────────────────────────────
document.getElementById('btn-seed').addEventListener('click', async () => {
  const btn = document.getElementById('btn-seed');
  btn.disabled = true;
  btn.textContent = '⏳ Seeding…';

  const players = Array.from({ length: 30 }, (_, i) => ({
    playerId: `player-${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) || ''}`,
    points: Math.floor(Math.random() * 950) + 50,
  }));

  let ok = 0;
  for (const p of players) {
    const r = await api('POST', '/api/leaderboard/scores', p);
    if (r.ok) ok++;
  }

  toast(`Seeded ${ok}/${players.length} players ✓`, 'success');
  btn.disabled = false;
  btn.textContent = '🌱 Seed Demo Data';
  refreshLeaderboard();
});

// ── Score Submit Form ──────────────────────────────────────────────
document.getElementById('score-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const playerId = document.getElementById('score-player-id').value.trim();
  const points   = parseFloat(document.getElementById('score-points').value);
  const result   = document.getElementById('score-form-result');

  if (!playerId || isNaN(points)) { result.textContent = 'Please fill all fields.'; result.className = 'form-result error'; return; }

  const { ok, data } = await api('POST', '/api/leaderboard/scores', { playerId, points });
  if (ok) {
    result.textContent = `✓ ${playerId} → new score: ${data.newScore}`;
    result.className = 'form-result success';
    toast(`Score submitted: ${playerId} now at ${data.newScore}`, 'success');
    refreshLeaderboard();
  } else {
    result.textContent = `✗ ${data.error || 'Unknown error'}`;
    result.className = 'form-result error';
  }
});

// ── Player Rank Lookup ─────────────────────────────────────────────
document.getElementById('player-lookup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const playerId = document.getElementById('lookup-player-id').value.trim();
  const container = document.getElementById('player-lookup-result');

  if (!playerId) return;

  const { ok, data } = await api('GET', `/api/leaderboard/player/${encodeURIComponent(playerId)}`);

  if (!ok) {
    container.innerHTML = `<p class="form-result error">✗ ${data.error || 'Player not found'}</p>`;
    return;
  }

  const renderRow = (p, isTarget = false) =>
    `<div class="nearby-row ${isTarget ? 'target-row' : ''}">
       <span class="nb-rank">#${p.rank}</span>
       <span class="nb-id">${escHtml(p.playerId)}</span>
       <span class="nb-score">${p.score.toLocaleString()}</span>
     </div>`;

  const aboveRows = (data.nearbyPlayers.above || []).map(p => renderRow(p)).join('');
  const belowRows = (data.nearbyPlayers.below || []).map(p => renderRow(p)).join('');

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">#${data.rank}</div><div class="stat-label">Rank</div></div>
      <div class="stat-card"><div class="stat-value">${data.score.toLocaleString()}</div><div class="stat-label">Score</div></div>
      <div class="stat-card"><div class="stat-value">${data.percentile}%</div><div class="stat-label">Percentile</div></div>
    </div>
    <div class="nearby-section">
      <h3>👆 Above</h3>${aboveRows || '<p class="empty-state" style="padding:8px">Top of the board!</p>'}
      ${renderRow(data, true)}
      <h3 style="margin-top:8px">👇 Below</h3>${belowRows || '<p class="empty-state" style="padding:8px">Bottom of the board!</p>'}
    </div>`;
});

// ── Game: Create Round ─────────────────────────────────────────────
document.getElementById('round-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    gameId:          document.getElementById('round-game-id').value.trim(),
    roundId:         document.getElementById('round-id').value.trim(),
    correctAnswer:   document.getElementById('round-answer').value.trim(),
    durationSeconds: parseInt(document.getElementById('round-duration').value, 10),
  };
  const result = document.getElementById('round-result');

  const { ok, data } = await api('POST', '/api/game/rounds', body);
  if (ok) {
    result.textContent = `✓ Round created! Ends: ${new Date(data.endTime).toLocaleTimeString()}`;
    result.className = 'form-result success';
    toast('Round created successfully', 'success');
  } else {
    result.textContent = `✗ ${data.error || 'Unknown error'}`;
    result.className = 'form-result error';
  }
});

// ── Game: Submit Answer ────────────────────────────────────────────
document.getElementById('answer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    gameId:   document.getElementById('ans-game-id').value.trim(),
    roundId:  document.getElementById('ans-round-id').value.trim(),
    playerId: document.getElementById('ans-player-id').value.trim(),
    answer:   document.getElementById('ans-answer').value.trim(),
  };
  const result = document.getElementById('answer-result');

  const { ok, status, data } = await api('POST', '/api/game/submit', body);

  if (ok) {
    result.textContent = `✓ SUCCESS — new score: ${data.newScore}`;
    result.className = 'form-result success';
    toast(`Correct! ${body.playerId} scored → ${data.newScore}`, 'success');
  } else if (status === 400 && data.code === 'DUPLICATE_SUBMISSION') {
    result.textContent = '✗ Duplicate submission — already answered this round';
    result.className = 'form-result error';
    toast('Duplicate submission rejected', 'error');
  } else if (status === 403 && data.code === 'ROUND_EXPIRED') {
    result.textContent = '✗ Round has expired';
    result.className = 'form-result error';
    toast('Round window has closed', 'error');
  } else {
    result.textContent = `✗ ${data.code || data.error || 'Unknown error'}`;
    result.className = 'form-result error';
  }
});

// ── Sessions: Create ──────────────────────────────────────────────
document.getElementById('session-create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    userId:     document.getElementById('sess-user-id').value.trim(),
    ipAddress:  document.getElementById('sess-ip').value.trim(),
    deviceType: document.getElementById('sess-device').value,
  };
  const result = document.getElementById('session-create-result');

  const { ok, data } = await api('POST', '/api/sessions', body);
  if (ok) {
    result.textContent = `✓ Session created: ${data.sessionId}`;
    result.className = 'form-result success';
    toast('Session created (old sessions invalidated)', 'success');

    // Auto-fill the lookup form
    document.getElementById('sess-lookup-id').value = body.userId;
  } else {
    result.textContent = `✗ ${data.error || 'Unknown error'}`;
    result.className = 'form-result error';
  }
});

// ── Sessions: Lookup ──────────────────────────────────────────────
document.getElementById('session-lookup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = document.getElementById('sess-lookup-id').value.trim();
  const container = document.getElementById('sessions-list');

  const { ok, data } = await api('GET', `/api/admin/sessions/user/${encodeURIComponent(userId)}`);

  if (!ok) { container.innerHTML = `<p class="form-result error">✗ ${data.error || 'Error'}</p>`; return; }

  if (!data.length) { container.innerHTML = `<p class="form-result">No active sessions found for <strong>${escHtml(userId)}</strong></p>`; return; }

  container.innerHTML = data.map(s => `
    <div class="session-item" id="session-${escHtml(s.sessionId)}">
      <div class="session-id">🔑 ${escHtml(s.sessionId)}</div>
      <div class="session-meta">
        <span class="session-tag">📱 ${escHtml(s.deviceType)}</span>
        <span class="session-tag">🌐 ${escHtml(s.ipAddress)}</span>
        <span class="session-tag">🕐 ${new Date(s.lastActive).toLocaleString()}</span>
      </div>
      <div class="session-actions">
        <button class="btn btn-danger" onclick="deleteSession('${escHtml(userId)}','${escHtml(s.sessionId)}')">
          🗑️ Revoke
        </button>
      </div>
    </div>
  `).join('');
});

async function deleteSession(userId, sessionId) {
  const { ok } = await api('DELETE', `/api/admin/sessions/${encodeURIComponent(sessionId)}`);
  if (ok) {
    document.getElementById(`session-${sessionId}`)?.remove();
    toast('Session revoked', 'success');
  } else {
    toast('Failed to revoke session', 'error');
  }
}
// Make available globally for inline onclick
window.deleteSession = deleteSession;

// ── Escape HTML helper ─────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Init ───────────────────────────────────────────────────────────
(function init() {
  initTabs();
  initSSE();
  refreshLeaderboard();
})();
