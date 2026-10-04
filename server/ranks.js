'use strict';

/**
 * Rating tiers. Each rank also decides how hard the questions are: `weights` is the
 * chance of drawing a difficulty 1 (Easy), 2 (Medium), 3 (Hard) or 4 (Expert) question.
 * Rename tiers or move thresholds here and everything else follows.
 */
const RANKS = [
  { key: 'bronze', name: 'Bronze', icon: '🥉', color: '#cd7f32', min: 0, weights: [0.7, 0.3, 0, 0] },
  { key: 'silver', name: 'Silver', icon: '🥈', color: '#c0c7d6', min: 900, weights: [0.5, 0.4, 0.1, 0] },
  { key: 'gold', name: 'Gold', icon: '🥇', color: '#ffc857', min: 1100, weights: [0.25, 0.45, 0.25, 0.05] },
  { key: 'platinum', name: 'Platinum', icon: '💠', color: '#5ee6d0', min: 1300, weights: [0.1, 0.4, 0.4, 0.1] },
  { key: 'diamond', name: 'Diamond', icon: '💎', color: '#6cb6ff', min: 1500, weights: [0, 0.25, 0.5, 0.25] },
  { key: 'master', name: 'Master', icon: '👑', color: '#c38bff', min: 1700, weights: [0, 0.1, 0.45, 0.45] },
  { key: 'grandmaster', name: 'Grandmaster', icon: '🗿', color: '#ff6b9a', min: 1900, weights: [0, 0, 0.35, 0.65] },
];

const DIFFICULTY_LABELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Expert' };

function rankFor(rating) {
  let rank = RANKS[0];
  for (const r of RANKS) if (rating >= r.min) rank = r;
  return rank;
}

/** Public view of a rank, including progress toward the next tier. */
function rankInfo(rating) {
  const rank = rankFor(rating);
  const i = RANKS.indexOf(rank);
  const next = RANKS[i + 1] || null;
  return {
    key: rank.key,
    name: rank.name,
    icon: rank.icon,
    color: rank.color,
    tier: i + 1,
    next: next ? { name: next.name, at: next.min } : null,
    progress: next ? Math.max(0, Math.min(1, (rating - rank.min) / (next.min - rank.min))) : 1,
  };
}

/**
 * Difficulty weights for one round. Later rounds lean harder: each round shifts
 * `shift` of every level's weight up one level, so the double-points final is the toughest.
 */
function roundWeights(rating, roundIndex, totalRounds) {
  const w = rankFor(rating).weights.slice();
  const shift = totalRounds > 1 ? (0.25 * roundIndex) / (totalRounds - 1) : 0;
  for (let lvl = w.length - 2; lvl >= 0; lvl--) {
    const moved = w[lvl] * shift;
    w[lvl] -= moved;
    w[lvl + 1] += moved;
  }
  return w;
}

/** Draw a difficulty level (1–4) from weights. */
function drawLevel(weights, rand = Math.random) {
  let x = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i + 1;
  }
  return weights.length;
}

module.exports = { RANKS, DIFFICULTY_LABELS, rankFor, rankInfo, roundWeights, drawLevel };
