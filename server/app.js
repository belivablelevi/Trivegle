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

function createApp({
  dataDir = path.join(__dirname, '..', 'data'),
  persist = true,
  matchConfig = {},
  botTimeScale = 1,
  ads = adsConfigFromEnv(),
  iceServers = iceServersFromEnv(),
} = {}) {
  const store = new PlayerStore(persist ? path.join(dataDir, 'players.json') : null);
  const reportsFile = persist ? path.join(dataDir, 'reports.jsonl') : null;

  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);

  const sessions = new Map(); // socket.id -> session
  const queue = []; // sessions waiting for a ranked opponent
  const chatLimiter = createRateLimiter({ burst: 4, intervalMs: 1200 });

  // ---------- HTTP ----------
  app.disable('x-powered-by');
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/api/leaderboard', (_req, res) => res.json(store.leaderboard(50)));
  app.get('/api/config', (_req, res) => res.json({ ads, iceServers, difficulties: Object.keys(DIFFICULTIES) }));
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
        const rec = store.recordResult(p.id, {
          result: outcome,
          ratingDelta: deltas ? deltas[p.id] : 0,
          ranked: !!deltas,
          correct: stats.correct,
          answered: stats.answered,
        });
        result[p.id] = { ratingDelta: deltas ? deltas[p.id] : 0, rating: rec.rating };
      }
      for (const s of sessionsInMatch) {
        s.socket.emit('profile', publicProfile(s.player));
      }
      return result;
    };
  }

  function startMatch(sessionList, opponents, ranked, video = false) {
    const participants = [...sessionList.map(participantFor), ...opponents];
    const match = new Match({
      players: participants,
      ranked,
      video,
      config: matchConfig,
      onEnd: handleMatchEnd(sessionList),
    });
    match.chatLog = [];
    for (const o of opponents) o.attach?.(match);
    for (const s of sessionList) s.match = match;
    match.start();
    return match;
  }

  function tryMatchmake(session) {
    // Camera and text players have separate queues: nobody gets put on camera unexpectedly.
    const opponent = queue.find(
      (other) =>
        other !== session &&
        other.video === session.video &&
        other.player.id !== session.player.id &&
        !isBlocked(session, other),
    );
    if (!opponent) {
      if (!queue.includes(session)) queue.push(session);
      const sameMode = queue.filter((s) => s.video === session.video);
      session.socket.emit('queued', { position: sameMode.indexOf(session) + 1, video: session.video });
      return;
    }
    removeFromQueue(opponent);
    removeFromQueue(session);
    startMatch([opponent, session], [], true, session.video);
  }

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
    const session = { socket, player: null, match: null, lastMatch: null, video: false };
    sessions.set(socket.id, session);

    socket.on('hello', ({ token, name } = {}) => {
      const cleaned = name === undefined || name === '' ? undefined : cleanName(name);
      if (cleaned === null) {
        socket.emit('errorMsg', { message: 'That name is not allowed. Use 2–16 letters or numbers.' });
        return;
      }
      const { player, token: newToken } = store.login(token, cleaned);
      session.player = player;
      socket.emit('welcome', { token: newToken, profile: publicProfile(player) });
      broadcastStats();
    });

    socket.on('queue', ({ mode = 'ranked', difficulty = 'medium', video = false } = {}) => {
      if (!session.player) return;
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
    store.flush();
    io.close();
    httpServer.close();
  }

  return { app, httpServer, io, store, close };
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

module.exports = { createApp, adsConfigFromEnv, iceServersFromEnv };
