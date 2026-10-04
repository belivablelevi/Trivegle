'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Where player data and moderation reports are saved. Three interchangeable backends:
 *  - PostgresBackend: used when DATABASE_URL is set (e.g. a free Neon database). Needed on
 *    hosts whose disk is wiped on restart, like Render's free plan.
 *  - FileBackend: JSON files in a folder (local dev, or a Railway volume).
 *  - MemoryBackend: nothing is saved (tests).
 */

const REPORT_RETENTION_DAYS = 365;

class MemoryBackend {
  async load() {
    return [];
  }
  async savePlayers() {}
  async addReport() {}
  async pruneReports() {}
  async close() {}
}

class FileBackend {
  constructor(dir) {
    this.dir = dir;
    this.playersFile = path.join(dir, 'players.json');
    this.reportsFile = path.join(dir, 'reports.jsonl');
  }

  async load() {
    if (!fs.existsSync(this.playersFile)) return [];
    return JSON.parse(fs.readFileSync(this.playersFile, 'utf8')).players || [];
  }

  // The file always holds every player, so changed/deleted lists aren't needed here.
  async savePlayers({ all }) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.playersFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ players: all }));
    fs.renameSync(tmp, this.playersFile);
  }

  async addReport(entry) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.reportsFile, JSON.stringify(entry) + '\n');
  }

  async pruneReports(now = Date.now()) {
    pruneReportsFile(this.reportsFile, now);
  }

  async close() {}
}

/** Drop report lines older than the retention period stated in the Privacy Policy. */
function pruneReportsFile(file, now = Date.now()) {
  if (!fs.existsSync(file)) return;
  const cutoff = now - REPORT_RETENTION_DAYS * 864e5;
  const kept = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false;
      try {
        return Date.parse(JSON.parse(line).at) >= cutoff;
      } catch {
        return false;
      }
    });
  fs.writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '');
}

class PostgresBackend {
  constructor(connectionString) {
    const { Pool } = require('pg');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
    this.pool = new Pool({
      connectionString,
      ssl: local ? false : { rejectUnauthorized: false },
      max: 3,
      // Close idle connections quickly so free databases (e.g. Neon) can scale to zero.
      idleTimeoutMillis: 10_000,
    });
  }

  async load() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS reports (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL,
        data JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reports_at_idx ON reports (at);
    `);
    const { rows } = await this.pool.query('SELECT data FROM players');
    return rows.map((r) => r.data);
  }

  async savePlayers({ changed, deleted }) {
    if (!changed.length && !deleted.length) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const p of changed) {
        await client.query(
          `INSERT INTO players (id, data, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [p.id, p],
        );
      }
      if (deleted.length) await client.query('DELETE FROM players WHERE id = ANY($1)', [deleted]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async addReport(entry) {
    await this.pool.query('INSERT INTO reports (at, data) VALUES ($1, $2)', [entry.at, entry]);
  }

  async pruneReports() {
    await this.pool.query(`DELETE FROM reports WHERE at < now() - interval '${REPORT_RETENTION_DAYS} days'`);
  }

  async close() {
    await this.pool.end();
  }
}

function createBackend({ persist, databaseUrl, dataDir }) {
  if (!persist) return new MemoryBackend();
  if (databaseUrl) return new PostgresBackend(databaseUrl);
  return new FileBackend(dataDir);
}

module.exports = {
  createBackend,
  MemoryBackend,
  FileBackend,
  PostgresBackend,
  pruneReportsFile,
  REPORT_RETENTION_DAYS,
};
