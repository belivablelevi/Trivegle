'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');

const { createApp } = require('../server/app');

const FAST = { rounds: 2, questionsPerRound: 2, introMs: 5, roundIntroMs: 5, questionMs: 300, revealMs: 5, breakMs: 40 };

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function startServer(opts = {}) {
  const server = createApp({
    persist: false, matchConfig: FAST, botTimeScale: 0.01, devLogin: true, providers: {}, sessionSecret: 'test-secret', ...opts,
  });
  await new Promise((r) => server.httpServer.listen(0, r));
  const url = `http://localhost:${server.httpServer.address().port}`;
  return { ...server, url };
}

async function signIn(url, name) {
  const res = await fetch(`${url}/auth/dev?name=${encodeURIComponent(name)}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}

async function client(url, name) {
  const cookie = await signIn(url, name);
  const s = connect(url, { transports: ['websocket'], forceNew: true, extraHeaders: { cookie } });
  const welcome = once(s, 'welcome');
  s.emit('hello', { name });
  return { socket: s, cookie, welcome: await welcome };
}

test('two strangers get matched, play, chat, and the winner gains rating', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const alice = await client(srv.url, 'Alice');
  const bob = await client(srv.url, 'Bob');

  // Alice answers 0 on everything, Bob never answers -> Alice wins unless all her answers are wrong.
  alice.socket.on('question', (q) => alice.socket.emit('answer', { qIndex: q.qIndex, choice: 0 }));
  let aliceCorrect = 0;
  alice.socket.on('reveal', (r) => { if (r.you.correct) aliceCorrect += 1; });

  const bobChat = new Promise((resolve) => bob.socket.on('chat', (m) => m.from === 'opp' && resolve(m)));
  const found = once(bob.socket, 'matchFound');
  alice.socket.emit('queue', { mode: 'ranked' });
  bob.socket.emit('queue', { mode: 'ranked' });
  const match = await found;
  assert.equal(match.opponent.name, 'Alice');
  assert.equal(match.opponent.isBot, false);

  alice.socket.emit('chat', { text: 'gl hf, add me on snap: alice123' });
  const msg = await bobChat;
  assert.match(msg.text, /\[contact removed\]/);

  const [aEnd, bEnd] = await Promise.all([once(alice.socket, 'matchEnd'), once(bob.socket, 'matchEnd')]);
  if (aliceCorrect > 0) {
    assert.equal(aEnd.outcome, 'win');
    assert.equal(bEnd.outcome, 'loss');
    assert.ok(aEnd.ratingDelta > 0);
    assert.equal(aEnd.ratingDelta, -bEnd.ratingDelta);
  } else {
    assert.equal(aEnd.outcome, 'draw');
  }

  const lb = await (await fetch(`${srv.url}/api/leaderboard`)).json();
  assert.equal(lb.length, 2);
  assert.equal(lb[0].name, aliceCorrect > 0 ? 'Alice' : lb[0].name);

  alice.socket.close();
  bob.socket.close();
});

test('blocked players are not matched again', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const a = await client(srv.url, 'Ann');
  const b = await client(srv.url, 'Ben');

  const found = once(a.socket, 'matchFound');
  a.socket.emit('queue', { mode: 'ranked' });
  b.socket.emit('queue', { mode: 'ranked' });
  await found;
  a.socket.emit('block');
  await once(a.socket, 'chat');
  a.socket.emit('leaveMatch');

  const queued = once(a.socket, 'queued');
  a.socket.emit('queue', { mode: 'ranked' });
  b.socket.emit('queue', { mode: 'ranked' });
  await queued;
  const bQueued = await once(b.socket, 'queued');
  assert.equal(bQueued.position, 2);

  a.socket.close();
  b.socket.close();
});

test('practice vs bot is unranked and completes', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const p = await client(srv.url, 'Solo');
  const found = once(p.socket, 'matchFound');
  p.socket.emit('queue', { mode: 'practice', difficulty: 'hard' });
  const m = await found;
  assert.equal(m.opponent.isBot, true);
  assert.equal(m.ranked, false);
  const end = await once(p.socket, 'matchEnd');
  assert.equal(end.ranked, false);
  assert.equal(end.ratingDelta, 0);
  p.socket.close();
});

test('bad nicknames are rejected', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const { socket } = await client(srv.url, 'Polite');
  const err = once(socket, 'errorMsg');
  socket.emit('hello', { name: 'fuckface' });
  assert.match((await err).message, /not allowed/);
  socket.close();
});

test('playing requires sign-in; forged cookies are rejected', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  for (const cookie of [undefined, 'trivegle_session=someid|9999999999999.forgedsig']) {
    const s = connect(srv.url, { transports: ['websocket'], forceNew: true, extraHeaders: cookie ? { cookie } : {} });
    const required = once(s, 'authRequired');
    s.emit('hello', { name: 'Sneaky' });
    await required;
    const again = once(s, 'authRequired');
    s.emit('queue', { mode: 'practice' });
    await again;
    s.close();
  }
  const me = await (await fetch(`${srv.url}/api/me`)).json();
  assert.equal(me.player, null);
  assert.equal(me.devLogin, true);
});

test('sign-in persists the same player across connections and /api/me reports it', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const first = await client(srv.url, 'Repeat');
  const second = await client(srv.url, 'Repeat');
  assert.equal(srv.store.players.size, 1);
  const me = await (await fetch(`${srv.url}/api/me`, { headers: { cookie: first.cookie } })).json();
  assert.equal(me.player.name, 'Repeat');
  const out = await fetch(`${srv.url}/auth/logout`, { method: 'POST' });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  first.socket.close();
  second.socket.close();
});

test('OAuth providers redirect with a state check and reject tampered callbacks', async (t) => {
  const srv = await startServer({
    devLogin: false,
    providers: { google: { ...require('../server/auth').PROVIDERS.google, clientId: 'cid', clientSecret: 'sec' } },
  });
  t.after(() => srv.close());
  const start = await fetch(`${srv.url}/auth/google`, { redirect: 'manual' });
  const loc = new URL(start.headers.get('location'));
  assert.equal(loc.origin, 'https://accounts.google.com');
  assert.equal(loc.searchParams.get('client_id'), 'cid');
  assert.equal(loc.searchParams.get('redirect_uri'), `${srv.url}/auth/google/callback`);
  assert.ok(loc.searchParams.get('state'));

  const bad = await fetch(`${srv.url}/auth/google/callback?code=x&state=wrong`, {
    redirect: 'manual',
    headers: { cookie: start.headers.get('set-cookie').split(';')[0] },
  });
  assert.equal(bad.headers.get('location'), '/?auth_error=state');
  assert.equal((await fetch(`${srv.url}/auth/dev?name=x`, { redirect: 'manual' })).status, 404);
});

test('camera and text players use separate queues', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const cam = await client(srv.url, 'CamCat');
  const txt = await client(srv.url, 'TextTom');

  const camQueued = once(cam.socket, 'queued');
  cam.socket.emit('queue', { mode: 'ranked', video: true });
  assert.deepEqual(await camQueued, { position: 1, video: true });
  const txtQueued = once(txt.socket, 'queued');
  txt.socket.emit('queue', { mode: 'ranked' });
  assert.deepEqual(await txtQueued, { position: 1, video: false });

  cam.socket.close();
  txt.socket.close();
});

test('camera matches relay WebRTC signaling only to the opponent; text matches do not', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const a = await client(srv.url, 'Vid1');
  const b = await client(srv.url, 'Vid2');

  const aFound = once(a.socket, 'matchFound');
  const bFound = once(b.socket, 'matchFound');
  a.socket.emit('queue', { mode: 'ranked', video: true });
  b.socket.emit('queue', { mode: 'ranked', video: true });
  const [ma, mb] = await Promise.all([aFound, bFound]);
  assert.equal(ma.video, true);
  assert.equal(mb.video, true);
  assert.equal(ma.rtcInitiator !== mb.rtcInitiator, true, 'exactly one side creates the offer');

  const offerer = ma.rtcInitiator ? a : b;
  const answerer = ma.rtcInitiator ? b : a;
  const got = once(answerer.socket, 'rtc');
  offerer.socket.emit('rtc', { type: 'offer', data: { type: 'offer', sdp: 'v=0' } });
  assert.deepEqual(await got, { type: 'offer', data: { type: 'offer', sdp: 'v=0' } });

  // Unknown message types are dropped.
  let leaked = false;
  answerer.socket.on('rtc', (m) => { if (m.type === 'evil') leaked = true; });
  offerer.socket.emit('rtc', { type: 'evil', data: {} });

  // Text-mode matches never relay signaling.
  const c = await client(srv.url, 'Txt1');
  const d = await client(srv.url, 'Txt2');
  const cFound = once(c.socket, 'matchFound');
  c.socket.emit('queue', { mode: 'ranked' });
  d.socket.emit('queue', { mode: 'ranked' });
  const mc = await cFound;
  assert.equal(mc.video, false);
  assert.equal(mc.rtcInitiator, false);
  let relayed = false;
  d.socket.on('rtc', () => { relayed = true; });
  c.socket.emit('rtc', { type: 'offer', data: {} });

  await new Promise((r) => setTimeout(r, 100));
  assert.equal(leaked, false);
  assert.equal(relayed, false);
  for (const s of [a, b, c, d]) s.socket.close();
});

test('matchmaking pairs similar ratings first and widens the range while waiting', async (t) => {
  const srv = await startServer({ matchmaking: { baseGap: 150, gapPerSecond: 1000, tickMs: 50 } });
  t.after(() => srv.close());
  const pro = await client(srv.url, 'ProPlayer');
  const newbie = await client(srv.url, 'NewPlayer');
  const peer = await client(srv.url, 'PeerPlayer');
  const late = await client(srv.url, 'LatePlayer');
  t.after(() => [pro, newbie, peer, late].forEach((c) => c.socket.close()));
  srv.store.get([...srv.store.players.values()].find((p) => p.name === 'ProPlayer').id).rating = 1600;

  // Pro queues first, newbie second: 600 apart, so newbie isn't matched instantly...
  const proQueued = once(pro.socket, 'queued');
  pro.socket.emit('queue', { mode: 'ranked' });
  await proQueued;
  const peerFound = once(peer.socket, 'matchFound');
  newbie.socket.emit('queue', { mode: 'ranked' });
  peer.socket.emit('queue', { mode: 'ranked' });
  // ...and a same-rated peer arriving right after gets paired with the newbie.
  const m = await peerFound;
  assert.equal(m.opponent.name, 'NewPlayer');
  assert.equal(m.questionTier.name, 'Silver');

  // Alone in the queue, the pro still gets matched once the range has widened.
  const proFound = once(pro.socket, 'matchFound');
  late.socket.emit('queue', { mode: 'ranked' });
  const pm = await proFound;
  assert.equal(pm.opponent.name, 'LatePlayer');
  assert.equal(pm.you.rank.name, 'Diamond');
  assert.equal(pm.questionTier.name, 'Platinum', 'questions follow the average of both ratings (1300)');
});

test('questions report difficulty and players do not see repeats in their next match', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const p = await client(srv.url, 'Repeater');
  const seen = [];
  p.socket.on('question', (q) => {
    assert.ok([1, 2, 3, 4].includes(q.difficulty));
    assert.ok(['Easy', 'Medium', 'Hard', 'Expert'].includes(q.difficultyLabel));
    seen.push(q.text);
  });
  for (let i = 0; i < 2; i++) {
    const end = once(p.socket, 'matchEnd');
    p.socket.emit('queue', { mode: 'practice', difficulty: 'hard' });
    const result = await end;
    assert.ok(result.rank && result.rank.name);
  }
  assert.equal(seen.length, 8);
  assert.equal(new Set(seen).size, 8, 'no repeated questions across the two matches');
  p.socket.close();
});

test('privacy and terms pages are served; account deletion removes the player and signs them out', async (t) => {
  const srv = await startServer({ contactEmail: 'hello@example.com' });
  t.after(() => srv.close());
  for (const page of ['/privacy.html', '/terms.html', '/legal.js']) {
    assert.equal((await fetch(srv.url + page)).status, 200, page);
  }
  assert.equal((await (await fetch(`${srv.url}/api/config`)).json()).contactEmail, 'hello@example.com');

  assert.equal((await fetch(`${srv.url}/api/account/delete`, { method: 'POST' })).status, 401);

  const { socket, cookie } = await client(srv.url, 'Leaver');
  const gone = once(socket, 'disconnect');
  const res = await fetch(`${srv.url}/api/account/delete`, { method: 'POST', headers: { cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  await gone;
  assert.equal(srv.store.players.size, 0);
  const me = await (await fetch(`${srv.url}/api/me`, { headers: { cookie } })).json();
  assert.equal(me.player, null, 'old cookie no longer signs anyone in');
});
