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
      draw_interval INTEGER NOT NULL DEFAULT 10,
      next_draw_at INTEGER,
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
    CREATE TABLE IF NOT EXISTS banned_players (
      room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      player_id TEXT NOT NULL,
      banned_at INTEGER NOT NULL,
      PRIMARY KEY (room_code, player_id)
    );
  `);
  const columns = db.prepare('PRAGMA table_info(rooms)').all().map(column => column.name);
  if (!columns.includes('draw_interval')) db.exec('ALTER TABLE rooms ADD COLUMN draw_interval INTEGER NOT NULL DEFAULT 10');
  if (!columns.includes('next_draw_at')) db.exec('ALTER TABLE rooms ADD COLUMN next_draw_at INTEGER');
  const playerColumns = db.prepare('PRAGMA table_info(players)').all().map(column => column.name);
  if (!playerColumns.includes('returned_to_lobby')) db.exec('ALTER TABLE players ADD COLUMN returned_to_lobby INTEGER NOT NULL DEFAULT 0');
  return db;
}
