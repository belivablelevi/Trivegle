'use strict';

const crypto = require('crypto');

const DIFFICULTIES = {
  easy: { accuracy: 0.45, minMs: 5000, maxMs: 12000, rating: 800 },
  medium: { accuracy: 0.65, minMs: 3500, maxMs: 9000, rating: 1000 },
  hard: { accuracy: 0.85, minMs: 2000, maxMs: 6000, rating: 1300 },
};

const BOT_LINES = {
  break: [
    'GG so far. I\'m a bot, but I still have opinions.',
    'Beep boop. That last round was close.',
    'Fun fact: I was trained on 80 questions and zero vibes.',
    'Next round is mine. Probably. My accuracy is just a number.',
  ],
  win: ['Mogged by a bot 🤖 Try a harder category!', 'Bot supremacy. Rematch?'],
  lose: ['You mogged me. Respect. 🫡', 'Recalibrating... well played.'],
};

/**
 * A practice opponent. Clearly labelled as a bot in the UI — never pretend it's a person.
 */
function createBot({ difficulty = 'medium', timeScale = 1, rand = Math.random } = {}) {
  const level = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;
  const timers = new Set();
  let match = null;

  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const after = (ms, fn) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms * timeScale);
    timers.add(t);
  };

  const bot = {
    id: `bot-${crypto.randomUUID()}`,
    name: `TriviaBot (${difficulty})`,
    rating: level.rating,
    isBot: true,
    attach(m) {
      match = m;
    },
    stop() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
    send(event, payload) {
      if (!match) return;
      if (event === 'question') {
        const delay = level.minMs + rand() * (level.maxMs - level.minMs);
        after(Math.min(delay, payload.durationMs - 250), () => {
          // The bot peeks at the answer key and decides whether to get it right.
          const answer = match.current?.q.answer;
          if (answer === undefined) return;
          const choice = rand() < level.accuracy
            ? answer
            : pick([0, 1, 2, 3].filter((i) => i !== answer));
          match.answer(bot.id, payload.qIndex, choice);
        });
      } else if (event === 'break') {
        after(1500 + rand() * 2000, () => match.chat(bot.id, pick(BOT_LINES.break)));
        after(500, () => match.setReady(bot.id));
      } else if (event === 'matchEnd') {
        bot.stop();
        if (payload.reason === 'complete' && payload.outcome !== 'draw') {
          const line = pick(payload.outcome === 'win' ? BOT_LINES.win : BOT_LINES.lose);
          after(1200, () => match.chat(bot.id, line));
        }
      } else if (event === 'opponentLeft') {
        bot.stop();
      }
    },
  };
  return bot;
}

module.exports = { createBot, DIFFICULTIES };
