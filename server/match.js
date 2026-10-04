'use strict';

const crypto = require('crypto');
const { pickCategories, pickQuestions, pickTopic } = require('./questions');

const DEFAULT_CONFIG = {
  rounds: 3,
  questionsPerRound: 3,
  introMs: 3000,
  roundIntroMs: 2500,
  questionMs: 15000,
  revealMs: 2500,
  breakMs: 25000,
  basePoints: 100,
  speedBonus: 50,
};

function scoreAnswer({ correct, elapsedMs, questionMs, multiplier, basePoints, speedBonus }) {
  if (!correct) return 0;
  const remaining = Math.max(0, questionMs - elapsedMs) / questionMs;
  return Math.round((basePoints + speedBonus * remaining) * multiplier);
}

/**
 * One 1v1 trivia battle. Participants are plain objects:
 *   { id, name, rating, isBot, send(event, payload) }
 * The match never talks to sockets directly, which keeps it testable.
 */
class Match {
  constructor({ players, ranked, config = {}, onEnd = () => ({}), rand = Math.random }) {
    if (players.length !== 2) throw new Error('A match needs exactly 2 players');
    this.id = crypto.randomUUID();
    this.players = players;
    this.ranked = ranked;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onEnd = onEnd;
    this.rand = rand;
    this.categories = pickCategories(this.config.rounds, rand);
    this.scores = Object.fromEntries(players.map((p) => [p.id, 0]));
    this.stats = Object.fromEntries(players.map((p) => [p.id, { correct: 0, answered: 0 }]));
    this.phase = 'created';
    this.round = -1;
    this.qIndex = -1;
    this.current = null;
    this.ready = new Set();
    this.timer = null;
    this.closed = false;
  }

  opponentOf(id) {
    return this.players.find((p) => p.id !== id);
  }

  has(id) {
    return this.players.some((p) => p.id === id);
  }

  scoresFor(id) {
    return { you: this.scores[id], opp: this.scores[this.opponentOf(id).id] };
  }

  each(fn) {
    for (const p of this.players) fn(p, this.opponentOf(p.id));
  }

  later(ms, fn) {
    clearTimeout(this.timer);
    this.timer = setTimeout(fn, ms);
  }

  start() {
    const { rounds, questionsPerRound, questionMs, breakMs } = this.config;
    this.phase = 'intro';
    this.each((p, opp) =>
      p.send('matchFound', {
        matchId: this.id,
        ranked: this.ranked,
        you: { name: p.name, rating: p.rating },
        opponent: { name: opp.name, rating: opp.rating, isBot: !!opp.isBot },
        categories: this.categories,
        rounds,
        questionsPerRound,
        questionMs,
        breakMs,
      }),
    );
    this.later(this.config.introMs, () => this.startRound(0));
  }

  startRound(r) {
    if (this.phase === 'ended') return;
    this.phase = 'roundIntro';
    this.round = r;
    this.ready.clear();
    this.roundQuestions = pickQuestions(this.categories[r], this.config.questionsPerRound, this.rand);
    this.roundQ = -1;
    this.multiplier = r === this.config.rounds - 1 ? 2 : 1;
    this.each((p) =>
      p.send('roundStart', {
        round: r + 1,
        totalRounds: this.config.rounds,
        category: this.categories[r],
        multiplier: this.multiplier,
        scores: this.scoresFor(p.id),
      }),
    );
    this.later(this.config.roundIntroMs, () => this.askNext());
  }

  askNext() {
    if (this.phase === 'ended') return;
    this.roundQ += 1;
    if (this.roundQ >= this.roundQuestions.length) return this.endRound();
    this.qIndex += 1;
    const q = this.roundQuestions[this.roundQ];
    this.phase = 'question';
    this.current = { q, qIndex: this.qIndex, startedAt: Date.now(), answers: {} };
    this.each((p) =>
      p.send('question', {
        qIndex: this.qIndex,
        round: this.round + 1,
        number: this.roundQ + 1,
        of: this.roundQuestions.length,
        category: q.category,
        text: q.text,
        choices: q.choices,
        durationMs: this.config.questionMs,
        multiplier: this.multiplier,
      }),
    );
    this.later(this.config.questionMs, () => this.reveal());
  }

  answer(playerId, qIndex, choice) {
    const cur = this.current;
    if (this.phase !== 'question' || !cur || cur.qIndex !== qIndex) return false;
    if (cur.answers[playerId] || !Number.isInteger(choice) || choice < 0 || choice >= cur.q.choices.length) {
      return false;
    }
    cur.answers[playerId] = { choice, elapsedMs: Date.now() - cur.startedAt };
    this.opponentOf(playerId).send('opponentAnswered', { qIndex });
    if (this.players.every((p) => cur.answers[p.id])) this.reveal();
    return true;
  }

  reveal() {
    if (this.phase !== 'question') return;
    this.phase = 'reveal';
    const { q, qIndex, answers } = this.current;
    const results = {};
    for (const p of this.players) {
      const a = answers[p.id];
      const correct = !!a && a.choice === q.answer;
      const points = scoreAnswer({
        correct,
        elapsedMs: a ? a.elapsedMs : Infinity,
        questionMs: this.config.questionMs,
        multiplier: this.multiplier,
        basePoints: this.config.basePoints,
        speedBonus: this.config.speedBonus,
      });
      this.scores[p.id] += points;
      if (a) this.stats[p.id].answered += 1;
      if (correct) this.stats[p.id].correct += 1;
      results[p.id] = { choice: a ? a.choice : null, correct, points, ms: a ? a.elapsedMs : null };
    }
    this.each((p, opp) =>
      p.send('reveal', {
        qIndex,
        answer: q.answer,
        you: results[p.id],
        opp: results[opp.id],
        scores: this.scoresFor(p.id),
      }),
    );
    this.later(this.config.revealMs, () => this.askNext());
  }

  endRound() {
    if (this.round >= this.config.rounds - 1) return this.finish('complete');
    this.phase = 'break';
    this.ready.clear();
    const topic = pickTopic(this.rand);
    const nextCategory = this.categories[this.round + 1];
    this.each((p) =>
      p.send('break', {
        round: this.round + 1,
        nextCategory,
        nextIsFinal: this.round + 1 === this.config.rounds - 1,
        topic,
        durationMs: this.config.breakMs,
        scores: this.scoresFor(p.id),
      }),
    );
    this.later(this.config.breakMs, () => this.startRound(this.round + 1));
  }

  setReady(playerId) {
    if (this.phase !== 'break' || this.ready.has(playerId)) return;
    this.ready.add(playerId);
    this.opponentOf(playerId).send('opponentReady', {});
    if (this.players.every((p) => this.ready.has(p.id))) this.startRound(this.round + 1);
  }

  chat(playerId, text) {
    // Chat stays open after the match ends (GG!) until someone moves on.
    if (this.closed || !text) return;
    this.each((p) => p.send('chat', { from: p.id === playerId ? 'you' : 'opp', text }));
  }

  /** A player left or disconnected. Mid-match, their opponent wins by forfeit. */
  leave(playerId) {
    if (this.closed) return;
    if (this.phase !== 'ended') this.finish('forfeit', playerId);
    this.closed = true;
    this.opponentOf(playerId).send('opponentLeft', {});
  }

  finish(reason, forfeiterId = null) {
    if (this.phase === 'ended') return;
    clearTimeout(this.timer);
    this.phase = 'ended';
    const [a, b] = this.players;
    let winnerId = null;
    if (forfeiterId) winnerId = this.opponentOf(forfeiterId).id;
    else if (this.scores[a.id] !== this.scores[b.id]) winnerId = this.scores[a.id] > this.scores[b.id] ? a.id : b.id;

    // onEnd persists results and returns per-player rating info: { [id]: { ratingDelta, rating } }
    const ratings = this.onEnd({ match: this, winnerId, reason, forfeiterId }) || {};

    this.each((p) => {
      const outcome = winnerId === null ? 'draw' : winnerId === p.id ? 'win' : 'loss';
      p.send('matchEnd', {
        outcome,
        reason,
        scores: this.scoresFor(p.id),
        stats: this.stats[p.id],
        ranked: this.ranked,
        ratingDelta: ratings[p.id]?.ratingDelta ?? 0,
        rating: ratings[p.id]?.rating ?? p.rating,
      });
    });
  }
}

module.exports = { Match, DEFAULT_CONFIG, scoreAnswer };
