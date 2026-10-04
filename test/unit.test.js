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
  // Harder questions are worth more base points.
  assert.equal(scoreAnswer({ ...base, correct: true, elapsedMs: 10000, multiplier: 1, level: 4, difficultyBonus: 20 }), 160);
});

test('question bank: 1,280 unique questions, 16 categories, 20 per difficulty, 4 unique choices', () => {
  const all = Object.values(BANK).flat();
  assert.equal(all.length, 1280);
  assert.equal(Object.keys(BANK).length, 16);
  assert.equal(new Set(all.map((q) => q.text.toLowerCase())).size, all.length, 'no duplicate questions');
  for (const [cat, entries] of Object.entries(BANK)) {
    for (const level of [1, 2, 3, 4]) {
      assert.equal(entries.filter((e) => e.level === level).length, 20, `${cat} level ${level}`);
    }
    for (const e of entries) {
      const choices = [e.correct, ...e.wrong];
      assert.equal(choices.length, 4, `bad entry in ${cat}: ${e.text}`);
      assert.equal(new Set(choices.map((c) => c.toLowerCase())).size, 4, `duplicate choice in ${cat}: ${e.text}`);
    }
  }
});

test('pickQuestions follows difficulty weights, avoids recently seen questions, keeps answer keys right', () => {
  const cat = pickCategories(1)[0];
  const expertOnly = pickQuestions(cat, 3, { weights: [0, 0, 0, 1] });
  assert.ok(expertOnly.every((q) => q.level === 4));
  const easyOnly = pickQuestions(cat, 3, { weights: [1, 0, 0, 0] });
  assert.ok(easyOnly.every((q) => q.level === 1));

  const seen = new Set(BANK[cat].filter((e) => e.level === 1).slice(0, 18).map((e) => e.id));
  const fresh = pickQuestions(cat, 2, { weights: [1, 0, 0, 0], exclude: seen });
  assert.ok(fresh.every((q) => !seen.has(q.id)), 'unseen questions preferred');

  for (const q of [...expertOnly, ...easyOnly]) {
    const original = BANK[q.category].find((e) => e.id === q.id);
    assert.equal(q.choices[q.answer], original.correct);
  }
});

test('ranks: thresholds, progress and harder questions at higher ranks', () => {
  const { rankFor, rankInfo, roundWeights, RANKS } = require('../server/ranks');
  assert.equal(rankFor(0).name, 'Bronze');
  assert.equal(rankFor(1000).name, 'Silver');
  assert.equal(rankFor(1100).name, 'Gold');
  assert.equal(rankFor(2500).name, 'Grandmaster');
  assert.equal(RANKS.length, 7);
  const info = rankInfo(1000);
  assert.equal(info.next.name, 'Gold');
  assert.equal(info.progress, 0.5);
  assert.equal(rankInfo(2000).next, null);

  const avg = (w) => w.reduce((sum, x, i) => sum + x * (i + 1), 0) / w.reduce((a, b) => a + b, 0);
  assert.ok(avg(roundWeights(800, 0, 3)) < avg(roundWeights(1200, 0, 3)));
  assert.ok(avg(roundWeights(1200, 0, 3)) < avg(roundWeights(2000, 0, 3)));
  assert.ok(avg(roundWeights(1200, 0, 3)) < avg(roundWeights(1200, 2, 3)), 'final round is harder');
  for (const r of [0, 1, 2]) {
    const w = roundWeights(1500, r, 3);
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9);
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

test('store: accounts map to one player and results update rating/streaks', () => {
  const store = new PlayerStore(null);
  const player = store.findOrCreateByAccount('google', '12345');
  assert.equal(player.needsName, true);
  assert.equal(store.findOrCreateByAccount('google', '12345').id, player.id);
  assert.notEqual(store.findOrCreateByAccount('facebook', '12345').id, player.id);
  store.rename(player.id, 'Alice');
  assert.equal(player.needsName, false);
  assert.equal(store.isNameTaken('alice'), true);
  assert.equal(store.isNameTaken('ALICE', player.id), false);

  store.recordResult(player.id, { result: 'win', ratingDelta: 16, ranked: true, correct: 5, answered: 9 });
  store.recordResult(player.id, { result: 'win', ratingDelta: 14, ranked: true, correct: 6, answered: 9 });
  store.recordResult(player.id, { result: 'loss', ratingDelta: -20, ranked: true, correct: 2, answered: 9 });
  const p = store.get(player.id);
  assert.equal(p.rating, 1010);
  assert.equal(p.bestStreak, 2);
  assert.equal(p.streak, 0);
  assert.equal(store.leaderboard()[0].accuracy, 48);
  assert.equal(p.peakRating, 1030);
  assert.equal(store.leaderboard()[0].rank.name, 'Silver');

  store.rememberQuestions(player.id, Array.from({ length: 450 }, (_, i) => `q${i}`));
  assert.equal(p.recentQuestions.length, 400);
  assert.equal(p.recentQuestions.at(-1), 'q449');
});

test('signed cookies: tampering is detected', () => {
  const { createSigner } = require('../server/auth');
  const signer = createSigner('secret');
  const signed = signer.sign('player|123');
  assert.equal(signer.verify(signed), 'player|123');
  assert.equal(signer.verify(signed.replace('player', 'admin')), null);
  assert.equal(signer.verify('garbage'), null);
});

test('reports older than 12 months are pruned', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { pruneReportsFile: pruneReports } = require('../server/persistence');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trivegle-')), 'reports.jsonl');
  const now = Date.parse('2026-10-04T00:00:00Z');
  fs.writeFileSync(file, [
    JSON.stringify({ at: '2025-01-01T00:00:00Z', reason: 'old' }),
    JSON.stringify({ at: '2026-09-01T00:00:00Z', reason: 'recent' }),
    'not json',
  ].join('\n') + '\n');
  pruneReports(file, now);
  const left = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l).reason);
  assert.deepEqual(left, ['recent']);
});
