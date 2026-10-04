'use strict';

const fs = require('fs');
const path = require('path');
const { drawLevel } = require('./ranks');

// Question files live in server/question-bank/, one per category:
//   module.exports = { category: 'Science', questions: [[level, question, correct, wrong1, wrong2, wrong3], ...] }
// level: 1 Easy, 2 Medium, 3 Hard, 4 Expert. The correct answer is always listed first;
// choices are shuffled per match.
const BANK_DIR = path.join(__dirname, 'question-bank');

function loadBank(dir = BANK_DIR) {
  const bank = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    const { category, questions } = require(path.join(dir, file));
    bank[category] = questions.map(([level, text, correct, ...wrong], i) => ({
      id: `${category}:${i}`,
      category,
      level,
      text,
      correct,
      wrong,
    }));
  }
  return bank;
}

const BANK = loadBank();

// Conversation prompts shown during the chat break between rounds.
const TALK_TOPICS = [
  'Hot take: what\'s an overrated movie everyone loves?',
  'If you could master one skill instantly, what would it be?',
  'What\'s the best snack for a late-night study session?',
  'Which fictional world would you actually live in?',
  'What\'s a fact you learned recently that blew your mind?',
  'Cats or dogs — defend your answer in one sentence.',
  'What song is stuck in your head right now?',
  'If you had a trivia specialty, what would it be?',
  'What\'s the most useless talent you have?',
  'Pineapple on pizza: yes or no?',
  'What game have you sunk the most hours into?',
  'Which decade had the best music?',
  'What would your walk-up song be?',
  'If you could ask a historical figure one question, who and what?',
  'What\'s the best advice you\'ve ever gotten?',
  'Trash-talk round: tell your opponent why the next round is yours.',
];

const CATEGORIES = Object.keys(BANK);

function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toQuestion(entry, rand) {
  const choices = shuffle([entry.correct, ...entry.wrong], rand);
  return {
    id: entry.id,
    category: entry.category,
    level: entry.level,
    text: entry.text,
    choices,
    answer: choices.indexOf(entry.correct),
  };
}

/** Pick `count` distinct random categories. */
function pickCategories(count, rand = Math.random) {
  return shuffle(CATEGORIES, rand).slice(0, Math.min(count, CATEGORIES.length));
}

/**
 * Pick `count` questions from a category. Each question's difficulty is drawn from
 * `weights` (chance of level 1..4); questions in `exclude` (recently seen) are skipped
 * when possible. Falls back to the nearest difficulty when a level runs dry.
 */
function pickQuestions(category, count, { weights = [0.25, 0.25, 0.25, 0.25], exclude = new Set(), rand = Math.random } = {}) {
  const entries = BANK[category];
  if (!entries) throw new Error(`Unknown category: ${category}`);
  const used = new Set();
  const picked = [];
  const pool = (level, allowSeen) =>
    entries.filter((e) => e.level === level && !used.has(e.id) && (allowSeen || !exclude.has(e.id)));

  for (let n = 0; n < count && used.size < entries.length; n++) {
    const target = drawLevel(weights, rand);
    // Try the target level, then levels further away, first among unseen questions.
    const order = [0, -1, 1, -2, 2, -3, 3].map((d) => target + d).filter((l) => l >= 1 && l <= 4);
    let choice = null;
    for (const allowSeen of [false, true]) {
      for (const level of order) {
        const options = pool(level, allowSeen);
        if (options.length) {
          choice = options[Math.floor(rand() * options.length)];
          break;
        }
      }
      if (choice) break;
    }
    used.add(choice.id);
    picked.push(choice);
  }
  // Easier questions first within a round.
  return picked.sort((a, b) => a.level - b.level).map((e) => toQuestion(e, rand));
}

function pickTopic(rand = Math.random) {
  return TALK_TOPICS[Math.floor(rand() * TALK_TOPICS.length)];
}

module.exports = { BANK, CATEGORIES, TALK_TOPICS, shuffle, pickCategories, pickQuestions, pickTopic };
