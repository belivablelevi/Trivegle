'use strict';

const crypto = require('crypto');

const { rankInfo } = require('./ranks');
const { MemoryBackend } = require('./persistence');

const STARTING_RATING = 1000;
const RECENT_QUESTIONS = 400; // how many recent question ids to avoid repeating

/**
 * In-memory player store that saves changes through a persistence backend
 * (Postgres, JSON file, or nothing). Good enough for a single server process.
 */
class PlayerStore {
  constructor(backend) {
    this.backend = backend || new MemoryBackend();
    this.players = new Map(); // id -> player
    this.byAccount = new Map(); // "provider:providerId" -> player id
    this.dirty = new Set(); // player ids changed since the last save
    this.deleted = new Set(); // player ids deleted since the last save
    this.saveTimer = null;
    this.saving = Promise.resolve();
  }

  /** Load all players from the backend. Call once before serving traffic. */
  async init() {
    for (const p of await this.backend.load()) {
      this.players.set(p.id, p);
      for (const acct of p.accounts || []) this.byAccount.set(acct, p.id);
    }
  }

  /** Mark a player as changed; changes are written in batches about once a second. */
  scheduleSave(id) {
    if (id) this.dirty.add(id);
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 1000);
    this.saveTimer.unref?.();
  }

  /** Write pending changes now. Saves run one at a time; failed saves are retried. */
  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.saving = this.saving.then(async () => {
      const changedIds = [...this.dirty];
      const deleted = [...this.deleted];
      if (!changedIds.length && !deleted.length) return;
      this.dirty.clear();
      this.deleted.clear();
      const changed = changedIds.map((id) => this.players.get(id)).filter(Boolean);
      try {
        await this.backend.savePlayers({ changed, deleted, all: [...this.players.values()] });
      } catch (err) {
        console.error('[store] save failed, will retry:', err.message);
        changedIds.forEach((id) => this.dirty.add(id));
        deleted.forEach((id) => this.deleted.add(id));
        this.scheduleSave();
      }
    });
    return this.saving;
  }

  /**
   * Find the player linked to a sign-in account (e.g. "google" + Google user id), or create one.
   * New OAuth players get a placeholder name and are asked to pick a nickname.
   */
  findOrCreateByAccount(provider, providerId, nickname = null) {
    const key = `${provider}:${providerId}`;
    const existing = this.players.get(this.byAccount.get(key));
    if (existing) return existing;
    const player = {
      id: crypto.randomUUID(),
      accounts: [key],
      name: nickname || `Player${Math.floor(1000 + Math.random() * 9000)}`,
      needsName: !nickname,
      rating: STARTING_RATING,
      peakRating: STARTING_RATING,
      recentQuestions: [],
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
    this.byAccount.set(key, player.id);
    this.scheduleSave(player.id);
    return player;
  }

  /** Nicknames are unique (case-insensitive) so the leaderboard can't be impersonated. */
  isNameTaken(name, exceptId = null) {
    const lower = name.toLowerCase();
    for (const p of this.players.values()) {
      if (p.id !== exceptId && !p.needsName && p.name.toLowerCase() === lower) return true;
    }
    return false;
  }

  rename(id, name) {
    const p = this.players.get(id);
    if (!p || !name) return p;
    if (p.name !== name || p.needsName) {
      p.name = name;
      p.needsName = false;
      this.scheduleSave(id);
    }
    return p;
  }

  /** Permanently delete a player and their linked sign-in accounts. */
  deletePlayer(id) {
    const p = this.players.get(id);
    if (!p) return false;
    for (const acct of p.accounts || []) this.byAccount.delete(acct);
    this.players.delete(id);
    this.dirty.delete(id);
    this.deleted.add(id);
    // Remove them from other players' block lists too.
    for (const other of this.players.values()) {
      if (other.blocked?.includes(id)) {
        other.blocked = other.blocked.filter((b) => b !== id);
        this.dirty.add(other.id);
      }
    }
    this.scheduleSave();
    return true;
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
      p.peakRating = Math.max(p.peakRating || STARTING_RATING, p.rating);
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
    this.scheduleSave(id);
    return p;
  }

  /** Remember which questions a player has seen so new matches avoid repeats. */
  rememberQuestions(id, questionIds) {
    const p = this.players.get(id);
    if (!p) return;
    p.recentQuestions = [...(p.recentQuestions || []), ...questionIds].slice(-RECENT_QUESTIONS);
    this.scheduleSave(id);
  }

  leaderboard(limit = 50) {
    return [...this.players.values()]
      .filter((p) => p.wins + p.losses + p.draws > 0)
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins)
      .slice(0, limit)
      .map((p, i) => publicProfile(p, i + 1));
  }
}

function publicProfile(p, position) {
  const games = p.wins + p.losses + p.draws;
  return {
    position, // leaderboard position (1 = top)
    name: p.name,
    rating: p.rating,
    peakRating: p.peakRating || p.rating,
    rank: rankInfo(p.rating),
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
