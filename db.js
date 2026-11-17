import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const dir = process.env.DATA_DIR || path.join(import.meta.dirname, 'data');
mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(path.join(dir, 'foodfinder.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS rounds (
    id           INTEGER PRIMARY KEY,
    token        TEXT    NOT NULL UNIQUE,
    title        TEXT    NOT NULL DEFAULT '',
    pin_hash     TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    fail_count   INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS participants (
    id         INTEGER PRIMARY KEY,
    round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    ranking    TEXT,
    note       TEXT    NOT NULL DEFAULT '',
    updated_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS participants_name
    ON participants(round_id, name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash     TEXT    PRIMARY KEY,
    kind           TEXT    NOT NULL,
    round_id       INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
    participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
    expires_at     INTEGER NOT NULL
  );
`);
