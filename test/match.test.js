'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Match } = require('../server/match');

const FAST = { rounds: 2, questionsPerRound: 2, introMs: 5, roundIntroMs: 5, questionMs: 200, revealMs: 5, breakMs: 50 };

function fakePlayer(id) {
  const events = [];
  return { id, name: id, rating: 1000, events, send: (e, p) => events.push([e, p]), last: (e) => events.filter(([n]) => n === e).at(-1)?.[1] };
}

function waitFor(player, event, count = 1) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    (function poll() {
      const hits = player.events.filter(([n]) => n === event);
      if (hits.length >= count) return resolve(hits.at(-1)[1]);
      if (Date.now() > deadline) return reject(new Error(`timeout waiting for ${event}`));
      setTimeout(poll, 2);
    })();
  });
}

test('a full match: correct answers win, break can be skipped by both players readying', async () => {
  const a = fakePlayer('a');
  const b = fakePlayer('b');
  let ended = null;
  const m = new Match({ players: [a, b], ranked: true, config: FAST, onEnd: (r) => { ended = r; return {}; } });

  // A always answers correctly, B always answers wrong.
  const answerAll = (q) => {
    const correct = m.current.q.answer;
    m.answer('a', q.qIndex, correct);
    m.answer('b', q.qIndex, (correct + 1) % 4);
  };
  a.send = ((orig) => (e, p) => { orig(e, p); if (e === 'question') setImmediate(() => answerAll(p)); })(a.send);

  m.start();
  await waitFor(a, 'break');
  m.setReady('a');
  assert.equal(m.phase, 'break', 'one ready player does not skip');
  m.setReady('b');
  assert.equal(m.phase, 'roundIntro');

  const end = await waitFor(a, 'matchEnd');
  assert.equal(end.outcome, 'win');
  assert.equal(b.last('matchEnd').outcome, 'loss');
  assert.equal(ended.winnerId, 'a');
  assert.equal(m.stats.a.correct, 4);
  // Round 2 is the final round (double points), so A scored more in it.
  assert.ok(end.scores.you > 4 * 100);
  assert.equal(end.scores.opp, 0);
});

test('double answers and wrong question indexes are ignored', async () => {
  const a = fakePlayer('a');
  const b = fakePlayer('b');
  const m = new Match({ players: [a, b], ranked: false, config: FAST });
  m.start();
  const q = await waitFor(a, 'question');
  assert.equal(m.answer('a', q.qIndex + 1, 0), false);
  assert.equal(m.answer('a', q.qIndex, 7), false);
  assert.equal(m.answer('a', q.qIndex, 0), true);
  assert.equal(m.answer('a', q.qIndex, 1), false);
  assert.ok(b.last('opponentAnswered'));
  m.leave('b');
});

test('leaving mid-match forfeits to the opponent and closes chat', async () => {
  const a = fakePlayer('a');
  const b = fakePlayer('b');
  let ended = null;
  const m = new Match({ players: [a, b], ranked: true, config: FAST, onEnd: (r) => { ended = r; return {}; } });
  m.start();
  await waitFor(a, 'question');
  m.chat('a', 'hi');
  assert.equal(b.last('chat').from, 'opp');
  m.leave('b');
  assert.equal(ended.reason, 'forfeit');
  assert.equal(a.last('matchEnd').outcome, 'win');
  assert.ok(a.last('opponentLeft'));
  m.chat('a', 'hello?');
  assert.equal(b.events.filter(([e]) => e === 'chat').length, 1);
});
