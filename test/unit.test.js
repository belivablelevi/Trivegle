'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ratingDeltas, expectedScore } = require('../server/elo');
const { cleanChat, cleanName, createRateLimiter } = require('../server/moderation');
const { BANK, pickQuestions, pickCategories } = require('../server/questions');
const { scoreAnswer } = require('../server/match');
const { PlayerStore } = require('../server/store');

test('elo: equal ratings swing by half of K', () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
  assert.deepEqual(ratingDeltas(1000, 1000, 1), { a: 16, b: -16 });
  assert.deepEqual(ratingDeltas(1000, 1000, 0.5), { a: 0, b: -0 });
});

test('elo: upsets are worth more than expected wins', () => {
  const upset = ratingDeltas(900, 1300, 1).a;
  const expected = ratingDeltas(1300, 900, 1).a;
  assert.ok(upset > expected);
});

test('scoring: correct answers get base + speed bonus, doubled in final round', () => {
  const base = { questionMs: 10000, basePoints: 100, speedBonus: 50 };
  assert.equal(scoreAnswer({ ...base, correct: false, elapsedMs: 0, multiplier: 1 }), 0);
  assert.equal(scoreAnswer({ ...base, correct: true, elapsedMs: 0, multiplier: 1 }), 150);
  assert.equal(scoreAnswer({ ...base, correct: true, elapsedMs: 5000, multiplier: 1 }), 125);
  assert.equal(scoreAnswer({ ...base, correct: true, elapsedMs: 10000, multiplier: 2 }), 200);
});

test('questions: every entry has 4 unique choices and picks are well-formed', () => {
  for (const [cat, entries] of Object.entries(BANK)) {
    assert.ok(entries.length >= 3, `${cat} needs at least 3 questions`);
    for (const e of entries) {
      assert.equal(e.length, 5, `bad entry in ${cat}: ${e[0]}`);
      assert.equal(new Set(e.slice(1)).size, 4, `duplicate choice in ${cat}: ${e[0]}`);
    }
  }
  const cats = pickCategories(3);
  assert.equal(new Set(cats).size, 3);
  const qs = pickQuestions(cats[0], 3);
  assert.equal(qs.length, 3);
  for (const q of qs) {
    const original = BANK[q.category].find((e) => e[0] === q.text);
    assert.equal(q.choices[q.answer], original[1]);
  }
});

test('moderation: masks profanity, strips links and contact handles', () => {
  assert.equal(cleanChat('what the fuck'), 'what the ****');
  assert.match(cleanChat('go to https://evil.example now'), /\[link removed\]/);
  assert.match(cleanChat('add my snap: coolkid99'), /\[contact removed\]/);
  assert.equal(cleanChat('x'.repeat(500)).length, 200);
  assert.equal(cleanChat(42), '');
});

test('moderation: names', () => {
  assert.equal(cleanName('QuizGoblin'), 'QuizGoblin');
  assert.equal(cleanName('<script>'), 'script');
  assert.equal(cleanName('a'), null);
  assert.equal(cleanName('shithead'), null);
});

test('rate limiter allows a burst then throttles', () => {
  const rl = createRateLimiter({ burst: 2, intervalMs: 1000 });
  assert.ok(rl.allow('k', 0));
  assert.ok(rl.allow('k', 0));
  assert.ok(!rl.allow('k', 0));
  assert.ok(rl.allow('k', 1000));
});

test('store: login is stable per token and results update rating/streaks', () => {
  const store = new PlayerStore(null);
  const { player, token } = store.login(undefined, 'Alice');
  assert.equal(store.login(token).player.id, player.id);
  assert.notEqual(store.login('nope'.repeat(10)).player.id, player.id);

  store.recordResult(player.id, { result: 'win', ratingDelta: 16, ranked: true, correct: 5, answered: 9 });
  store.recordResult(player.id, { result: 'win', ratingDelta: 14, ranked: true, correct: 6, answered: 9 });
  store.recordResult(player.id, { result: 'loss', ratingDelta: -20, ranked: true, correct: 2, answered: 9 });
  const p = store.get(player.id);
  assert.equal(p.rating, 1010);
  assert.equal(p.bestStreak, 2);
  assert.equal(p.streak, 0);
  assert.equal(store.leaderboard()[0].accuracy, 48);
  assert.equal(p.tokenHash.includes(token), false, 'raw token is never stored');
});
