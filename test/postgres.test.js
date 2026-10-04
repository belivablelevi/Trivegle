'use strict';

// Runs only when TEST_DATABASE_URL points at a disposable Postgres database, e.g.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm test
// The test drops and recreates Trivegle's tables, so never point it at real data.

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');

const { createApp } = require('../server/app');
const { PostgresBackend } = require('../server/persistence');

const DB = process.env.TEST_DATABASE_URL;
const FAST = { rounds: 1, questionsPerRound: 2, introMs: 5, roundIntroMs: 5, questionMs: 200, revealMs: 5, breakMs: 20 };

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function start() {
  const server = createApp({
    databaseUrl: DB, matchConfig: FAST, botTimeScale: 0.01, devLogin: true, providers: {}, sessionSecret: 'pg-test',
  });
  await server.ready;
  await new Promise((r) => server.httpServer.listen(0, r));
  return { ...server, url: `http://localhost:${server.httpServer.address().port}` };
}

async function signIn(url, name) {
  const res = await fetch(`${url}/auth/dev?name=${name}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}

test('Postgres: players, stats and deletions survive a server restart', { skip: !DB && 'set TEST_DATABASE_URL to run' }, async () => {
  const admin = new PostgresBackend(DB);
  await admin.pool.query('DROP TABLE IF EXISTS players, reports');
  await admin.close();

  // First server: create two players, play a practice match, file a report row.
  let srv = await start();
  const cookie = await signIn(srv.url, 'PgPlayer');
  const other = await signIn(srv.url, 'PgDeleteMe');
  const s = connect(srv.url, { transports: ['websocket'], forceNew: true, extraHeaders: { cookie } });
  const welcome = once(s, 'welcome');
  s.emit('hello', {});
  await welcome;
  const end = once(s, 'matchEnd');
  s.emit('queue', { mode: 'practice' });
  await end;
  s.close();
  const del = await fetch(`${srv.url}/api/account/delete`, { method: 'POST', headers: { cookie: other } });
  assert.equal(del.status, 200);
  await srv.close(); // flushes pending saves

  const check = new PostgresBackend(DB);
  await check.addReport({ at: new Date(Date.now() - 400 * 864e5).toISOString(), reason: 'old' });
  await check.addReport({ at: new Date().toISOString(), reason: 'new' });
  await check.close();

  // Second server: same database, data is still there and old reports were pruned.
  srv = await start();
  const players = [...srv.store.players.values()];
  assert.equal(players.length, 1, 'deleted player stays deleted');
  assert.equal(players[0].name, 'PgPlayer');
  assert.equal(players[0].practiceGames, 1);
  assert.equal(players[0].recentQuestions.length, 2);
  const me = await (await fetch(`${srv.url}/api/me`, { headers: { cookie } })).json();
  assert.equal(me.player.name, 'PgPlayer', 'session cookie still works after restart');

  const db = new PostgresBackend(DB);
  const { rows } = await db.pool.query("SELECT data->>'reason' AS reason FROM reports");
  assert.deepEqual(rows.map((r) => r.reason), ['new']);
  await db.close();
  await srv.close();
});
