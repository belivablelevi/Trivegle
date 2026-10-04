'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STARTING_RATING = 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Tiny JSON-file player store. Good enough for a single server; swap for
 * Postgres/Redis when you scale past one process.
 */
class PlayerStore {
  constructor(file) {
    this.file = file;
    this.players = new Map(); // id -> player
    this.byTokenHash = new Map(); // tokenHash -> id
    this.saveTimer = null;
    this.load();
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    for (const p of data.players || []) {
      this.players.set(p.id, p);
      this.byTokenHash.set(p.tokenHash, p.id);
    }
  }

  scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 1000);
    this.saveTimer.unref?.();
  }

  flush() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ players: [...this.players.values()] }));
    fs.renameSync(tmp, this.file);
  }

  /** Find the player for a token, or create a new one. Returns { player, token }. */
  login(token, name) {
    if (typeof token === 'string' && token.length >= 32) {
      const id = this.byTokenHash.get(hashToken(token));
      const player = id && this.players.get(id);
      if (player) {
        if (name && name !== player.name) {
          player.name = name;
          this.scheduleSave();
        }
        return { player, token };
      }
    }
    const newToken = crypto.randomBytes(24).toString('hex');
    const player = {
      id: crypto.randomUUID(),
      tokenHash: hashToken(newToken),
      name: name || `Player${Math.floor(1000 + Math.random() * 9000)}`,
      rating: STARTING_RATING,
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      bestStreak: 0,
      practiceGames: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      createdAt: Date.now(),
    };
    this.players.set(player.id, player);
    this.byTokenHash.set(player.tokenHash, player.id);
    this.scheduleSave();
    return { player, token: newToken };
  }

  get(id) {
    return this.players.get(id);
  }

  /** Record a finished match. `result` is 'win' | 'loss' | 'draw'. */
  recordResult(id, { result, ratingDelta = 0, ranked, correct, answered }) {
    const p = this.players.get(id);
    if (!p) return null;
    p.correctAnswers += correct;
    p.totalAnswers += answered;
    if (!ranked) {
      p.practiceGames += 1;
    } else {
      p.rating = Math.max(100, p.rating + ratingDelta);
      if (result === 'win') {
        p.wins += 1;
        p.streak += 1;
        p.bestStreak = Math.max(p.bestStreak, p.streak);
      } else if (result === 'loss') {
        p.losses += 1;
        p.streak = 0;
      } else {
        p.draws += 1;
      }
    }
    this.scheduleSave();
    return p;
  }

  leaderboard(limit = 50) {
    return [...this.players.values()]
      .filter((p) => p.wins + p.losses + p.draws > 0)
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins)
      .slice(0, limit)
      .map((p, i) => publicProfile(p, i + 1));
  }
}

function publicProfile(p, rank) {
  const games = p.wins + p.losses + p.draws;
  return {
    rank,
    name: p.name,
    rating: p.rating,
    wins: p.wins,
    losses: p.losses,
    draws: p.draws,
    games,
    bestStreak: p.bestStreak,
    streak: p.streak,
    accuracy: p.totalAnswers ? Math.round((100 * p.correctAnswers) / p.totalAnswers) : 0,
  };
}

module.exports = { PlayerStore, publicProfile, STARTING_RATING };
