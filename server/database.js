import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(filename = process.env.DATABASE_PATH || '/app/data/bingo.sqlite') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY CHECK(length(code) = 4),
      host_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'lobby' CHECK(status IN ('lobby', 'playing', 'finished')),
      drawn TEXT NOT NULL DEFAULT '[]',
      winner_id TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      id TEXT NOT NULL,
      room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      name TEXT NOT NULL,
      card TEXT NOT NULL,
      marked TEXT NOT NULL DEFAULT '[12]',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (id, room_code)
    );
    CREATE INDEX IF NOT EXISTS rooms_expiry_idx ON rooms(expires_at);
  `);
  return db;
}
