'use strict';

const K_FACTOR = 32;

function expectedScore(rating, opponentRating) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/**
 * Returns the rating deltas for both players.
 * `outcome` is 1 if A won, 0 if B won, 0.5 for a draw.
 */
function ratingDeltas(ratingA, ratingB, outcome, k = K_FACTOR) {
  const deltaA = Math.round(k * (outcome - expectedScore(ratingA, ratingB)));
  return { a: deltaA, b: -deltaA };
}

module.exports = { K_FACTOR, expectedScore, ratingDeltas };
