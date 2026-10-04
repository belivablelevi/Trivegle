'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { Match } = require('./match');
const { createBot, DIFFICULTIES } = require('./bot');
const { PlayerStore, publicProfile } = require('./store');
const { ratingDeltas } = require('./elo');
const { cleanChat, cleanName, createRateLimiter } = require('./moderation');
const { setupAuth, providersFromEnv } = require('./auth');
const { rankFor, RANKS, DIFFICULTY_LABELS } = require('./ranks');

// Deployed (Railway sets RAILWAY_PROJECT_ID) counts as production even if NODE_ENV isn't set.
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_PROJECT_ID;

function createApp({
  // On Railway, attach a volume and data is stored there automatically.
  dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data'),
  persist = true,
  matchConfig = {},
  botTimeScale = 1,
  ads = adsConfigFromEnv(),
  iceServers = iceServersFromEnv(),
  providers = providersFromEnv(),
  // Dev sign-in lets anyone pick any name, so it is never enabled in production.
  devLogin = !IS_PRODUCTION && (process.env.DEV_LOGIN === '1' || Object.keys(providers).length === 0),
  sessionSecret = process.env.SESSION_SECRET,
  publicUrl = process.env.PUBLIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null),
  contactEmail = process.env.CONTACT_EMAIL || null,
  // Rating-based matchmaking: start by looking ±baseGap rating points away, widening
  // by gapPerSecond while waiting, so nobody waits forever in a quiet queue.
  matchmaking = { baseGap: 150, gapPerSecond: 25, tickMs: 1000 },
} = {}) {
  if (!sessionSecret) {
    if (IS_PRODUCTION) {
      throw new Error('SESSION_SECRET must be set in production (Railway: add it under your service\'s Variables).');
    }
    sessionSecret = require('crypto').randomBytes(32).toString('hex'); // dev: sessions reset on restart
  }
  if (persist && process.env.RAILWAY_PROJECT_ID && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATA_DIR) {
    console.warn('[trivegle] WARNING: no Railway volume attached. Player data will be lost on every redeploy.');
  }
  const store = new PlayerStore(persist ? path.join(dataDir, 'players.json') : null);
  const reportsFile = persist ? path.join(dataDir, 'reports.jsonl') : null;
  if (reportsFile) pruneReports(reportsFile);

  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);

  const sessions = new Map(); // socket.id -> session
  const queue = []; // sessions waiting for a ranked opponent
  const chatLimiter = createRateLimiter({ burst: 4, intervalMs: 1200 });

  // ---------- HTTP ----------
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // correct https:// callback URLs behind Render/Railway/Fly proxies
  const auth = setupAuth(app, { store, providers, devLogin, secret: sessionSecret, publicUrl });
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/api/leaderboard', (_req, res) => res.json(store.leaderboard(50)));
  const rankGuide = RANKS.map((r) => ({
    name: r.name,
    icon: r.icon,
    color: r.color,
    min: r.min,
    mix: r.weights
      .map((w, i) => ({ label: DIFFICULTY_LABELS[i + 1], pct: Math.round(w * 100) }))
      .filter((d) => d.pct > 0),
  }));
  app.get('/api/config', (_req, res) =>
    res.json({ ads, iceServers, ranks: rankGuide, contactEmail, difficulties: Object.keys(DIFFICULTIES) }));

  // Self-serve account deletion (linked from the Privacy Policy; also satisfies
  // Facebook's data-deletion requirement).
  app.post('/api/account/delete', (req, res) => {
    const player = auth.playerFromCookieHeader(req.headers.cookie);
    if (!player) return res.status(401).json({ error: 'Not signed in' });
    for (const s of sessions.values()) {
      if (s.player?.id !== player.id) continue;
      removeFromQueue(s);
      leaveMatch(s);
      s.socket.disconnect(true);
    }
    store.deletePlayer(player.id);
    auth.clearSession(res);
    res.json({ ok: true });
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, online: sessions.size }));
  app.get('/ads.txt', (_req, res) => {
    if (!ads.adsenseClient) return res.status(404).end();
    const pub = ads.adsenseClient.replace(/^ca-/, '');
    res.type('text/plain').send(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
  });

  // ---------- Helpers ----------
  function participantFor(session) {
    const p = session.player;
    return {
      id: p.id,
      name: p.name,
      rating: p.rating,
      isBot: false,
      send: (event, payload) => session.socket.emit(event, payload),
    };
  }

  function removeFromQueue(session) {
    const i = queue.indexOf(session);
    if (i !== -1) queue.splice(i, 1);
  }

  function leaveMatch(session) {
    const m = session.match;
    if (!m) return;
    session.match = null;
    session.lastMatch = m; // still reportable after hitting "Next"
    m.leave(session.player.id);
  }

  function isBlocked(a, b) {
    return (a.player.blocked || []).includes(b.player.id) || (b.player.blocked || []).includes(a.player.id);
  }

  function handleMatchEnd(sessionsInMatch) {
    return ({ match, winnerId }) => {
      const result = {};
      const humans = match.players.filter((p) => !p.isBot);
      let deltas = null;
      if (match.ranked && humans.length === 2) {
        const [a, b] = humans;
        const outcome = winnerId === null ? 0.5 : winnerId === a.id ? 1 : 0;
        const d = ratingDeltas(store.get(a.id).rating, store.get(b.id).rating, outcome);
        deltas = { [a.id]: d.a, [b.id]: d.b };
      }
      for (const p of humans) {
        const stats = match.stats[p.id];
        const outcome = winnerId === null ? 'draw' : winnerId === p.id ? 'win' : 'loss';
        const before = rankFor(store.get(p.id).rating);
        store.rememberQuestions(p.id, match.askedIds);
        const rec = store.recordResult(p.id, {
          result: outcome,
          ratingDelta: deltas ? deltas[p.id] : 0,
          ranked: !!deltas,
          correct: stats.correct,
          answered: stats.answered,
        });
        const after = rankFor(rec.rating);
        const rankChange = after.min > before.min ? 'up' : after.min < before.min ? 'down' : null;
        result[p.id] = { ratingDelta: deltas ? deltas[p.id] : 0, rating: rec.rating, rankChange };
      }
      for (const s of sessionsInMatch) {
        s.socket.emit('profile', publicProfile(s.player));
      }
      return result;
    };
  }

  function startMatch(sessionList, opponents, ranked, video = false) {
    const participants = [...sessionList.map(participantFor), ...opponents];
    // Question difficulty follows the human players' ratings (bots don't count),
    // and questions either player saw recently are avoided.
    const humans = sessionList.map((s) => s.player);
    const rating = Math.round(humans.reduce((sum, p) => sum + p.rating, 0) / humans.length);
    const exclude = new Set(humans.flatMap((p) => p.recentQuestions || []));
    const match = new Match({
      players: participants,
      ranked,
      video,
      rating,
      exclude,
      config: matchConfig,
      onEnd: handleMatchEnd(sessionList),
    });
    match.chatLog = [];
    for (const o of opponents) o.attach?.(match);
    for (const s of sessionList) s.match = match;
    match.start();
    return match;
  }

  /** How far apart in rating a waiting player is willing to be matched. */
  function ratingGap(session, now) {
    const waitedSec = (now - session.queuedAt) / 1000;
    return matchmaking.baseGap + matchmaking.gapPerSecond * waitedSec;
  }

  /** The closest-rated compatible opponent within either player's current rating gap. */
  function findOpponent(session, now = Date.now()) {
    let best = null;
    let bestDiff = Infinity;
    for (const other of queue) {
      // Camera and text players have separate queues: nobody gets put on camera unexpectedly.
      if (other === session || other.video !== session.video) continue;
      if (other.player.id === session.player.id || isBlocked(session, other)) continue;
      const diff = Math.abs(other.player.rating - session.player.rating);
      if (diff > Math.max(ratingGap(session, now), ratingGap(other, now))) continue;
      if (diff < bestDiff) {
        best = other;
        bestDiff = diff;
      }
    }
    return best;
  }

  function pair(a, b) {
    removeFromQueue(a);
    removeFromQueue(b);
    startMatch([a, b], [], true, a.video);
  }

  function tryMatchmake(session) {
    session.queuedAt = Date.now();
    const opponent = findOpponent(session);
    if (opponent) return pair(opponent, session);
    if (!queue.includes(session)) queue.push(session);
    const sameMode = queue.filter((s) => s.video === session.video);
    session.socket.emit('queued', { position: sameMode.indexOf(session) + 1, video: session.video });
  }

  // Re-check the queue regularly: rating gaps widen the longer people wait.
  const matchmakingTimer = setInterval(() => {
    for (const session of [...queue]) {
      if (!queue.includes(session)) continue;
      const opponent = findOpponent(session);
      if (opponent) pair(session, opponent);
    }
  }, matchmaking.tickMs);
  matchmakingTimer.unref();

  function broadcastStats() {
    let inMatch = 0;
    for (const s of sessions.values()) if (s.match && s.match.phase !== 'ended') inMatch += 1;
    const searchingCamera = queue.filter((s) => s.video).length;
    io.emit('stats', { online: sessions.size, searching: queue.length - searchingCamera, searchingCamera, inMatch });
  }
  const statsTimer = setInterval(broadcastStats, 5000);
  statsTimer.unref();

  // ---------- Sockets ----------
  io.on('connection', (socket) => {
    // Identity comes only from the signed session cookie set at sign-in.
    const session = {
      socket,
      player: auth.playerFromCookieHeader(socket.request.headers.cookie),
      match: null,
      lastMatch: null,
      video: false,
    };
    sessions.set(socket.id, session);

    socket.on('hello', ({ name } = {}) => {
      if (!session.player) {
        socket.emit('authRequired');
        return;
      }
      if (name !== undefined && name !== '') {
        const cleaned = cleanName(name);
        if (cleaned === null) {
          socket.emit('errorMsg', { message: 'That name is not allowed. Use 2–16 letters or numbers.' });
          return;
        }
        if (store.isNameTaken(cleaned, session.player.id)) {
          socket.emit('errorMsg', { message: 'That nickname is taken. Try another one.' });
          return;
        }
        store.rename(session.player.id, cleaned);
      }
      socket.emit('welcome', { profile: publicProfile(session.player), needsName: !!session.player.needsName });
      broadcastStats();
    });

    socket.on('queue', ({ mode = 'ranked', difficulty = 'medium', video = false } = {}) => {
      if (!session.player) return socket.emit('authRequired');
      if (session.player.needsName) {
        return socket.emit('errorMsg', { message: 'Pick a nickname first.' });
      }
      leaveMatch(session);
      removeFromQueue(session);
      session.video = video === true;
      if (mode === 'practice') {
        const bot = createBot({ difficulty, timeScale: botTimeScale });
        startMatch([session], [bot], false);
      } else {
        tryMatchmake(session);
      }
      broadcastStats();
    });

    socket.on('leaveQueue', () => {
      removeFromQueue(session);
      broadcastStats();
    });

    socket.on('answer', ({ qIndex, choice } = {}) => {
      session.match?.answer(session.player.id, qIndex, choice);
    });

    // WebRTC signaling relay (offer / answer / ICE candidates). Video itself flows
    // peer-to-peer and never touches this server.
    socket.on('rtc', (msg) => {
      const m = session.match;
      if (!m || !m.video || m.closed || !session.player) return;
      if (!msg || !['offer', 'answer', 'ice'].includes(msg.type)) return;
      if (JSON.stringify(msg).length > 16000) return;
      m.opponentOf(session.player.id).send('rtc', { type: msg.type, data: msg.data });
    });

    socket.on('ready', () => {
      session.match?.setReady(session.player.id);
    });

    socket.on('chat', ({ text } = {}) => {
      const m = session.match;
      if (!m || !session.player) return;
      if (!chatLimiter.allow(socket.id)) {
        socket.emit('chat', { from: 'system', text: 'Slow down a little!' });
        return;
      }
      const clean = cleanChat(text);
      if (!clean) return;
      m.chatLog.push({ from: session.player.id, text: clean, at: Date.now() });
      if (m.chatLog.length > 50) m.chatLog.shift();
      m.chat(session.player.id, clean);
    });

    socket.on('leaveMatch', () => {
      leaveMatch(session);
      broadcastStats();
    });

    socket.on('report', ({ reason = 'unspecified' } = {}) => {
      const m = session.match || session.lastMatch;
      if (!m || !session.player) return;
      const opp = m.opponentOf(session.player.id);
      if (opp.isBot) return;
      const entry = {
        at: new Date().toISOString(),
        matchId: m.id,
        reporter: session.player.id,
        reported: opp.id,
        reportedName: opp.name,
        reason: String(reason).slice(0, 100),
        transcript: m.chatLog.slice(-20),
      };
      if (reportsFile) {
        fs.mkdirSync(path.dirname(reportsFile), { recursive: true });
        fs.appendFileSync(reportsFile, JSON.stringify(entry) + '\n');
      }
      blockOpponent(session);
      socket.emit('chat', { from: 'system', text: 'Thanks — report sent and this player is blocked.' });
    });

    socket.on('block', () => {
      blockOpponent(session);
      socket.emit('chat', { from: 'system', text: 'Blocked. You won\'t be matched with them again.' });
    });

    socket.on('disconnect', () => {
      removeFromQueue(session);
      leaveMatch(session);
      chatLimiter.forget(socket.id);
      sessions.delete(socket.id);
      broadcastStats();
    });
  });

  function blockOpponent(session) {
    const m = session.match || session.lastMatch;
    if (!m) return;
    const opp = m.opponentOf(session.player.id);
    if (opp.isBot) return;
    const blocked = new Set(session.player.blocked || []);
    blocked.add(opp.id);
    session.player.blocked = [...blocked];
    store.scheduleSave();
  }

  function close() {
    clearInterval(statsTimer);
    clearInterval(matchmakingTimer);
    store.flush();
    io.close();
    httpServer.close();
  }

  return { app, httpServer, io, store, close };
}

const REPORT_RETENTION_DAYS = 365;

/** Drop moderation reports older than the retention period stated in the Privacy Policy. */
function pruneReports(file, now = Date.now()) {
  if (!fs.existsSync(file)) return;
  const cutoff = now - REPORT_RETENTION_DAYS * 864e5;
  const kept = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false;
      try {
        return Date.parse(JSON.parse(line).at) >= cutoff;
      } catch {
        return false;
      }
    });
  fs.writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '');
}

function adsConfigFromEnv(env = process.env) {
  return {
    adsenseClient: env.ADSENSE_CLIENT || null, // e.g. "ca-pub-1234567890123456"
    slots: {
      landing: env.ADSENSE_SLOT_LANDING || null,
      queue: env.ADSENSE_SLOT_QUEUE || null,
      results: env.ADSENSE_SLOT_RESULTS || null,
    },
  };
}

function iceServersFromEnv(env = process.env) {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  // A TURN server is needed for players behind strict NATs (roughly 10–20% of connections).
  if (env.TURN_URL) {
    servers.push({ urls: env.TURN_URL, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
  }
  return servers;
}

module.exports = { createApp, adsConfigFromEnv, iceServersFromEnv, pruneReports };
