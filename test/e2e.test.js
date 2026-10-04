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
  const server = createApp({ persist: false, matchConfig: FAST, botTimeScale: 0.01, ...opts });
  await new Promise((r) => server.httpServer.listen(0, r));
  const url = `http://localhost:${server.httpServer.address().port}`;
  return { ...server, url };
}

async function client(url, name) {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  const welcome = once(s, 'welcome');
  s.emit('hello', { name });
  return { socket: s, welcome: await welcome };
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

test('bad names are rejected', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const s = connect(srv.url, { transports: ['websocket'], forceNew: true });
  const err = once(s, 'errorMsg');
  s.emit('hello', { name: 'fuckface' });
  assert.match((await err).message, /not allowed/);
  s.close();
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
