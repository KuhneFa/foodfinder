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
    location     TEXT    NOT NULL DEFAULT '',     -- landet im Masterprompt
    pin_hash     TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    fail_count   INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    size         INTEGER NOT NULL DEFAULT 3,      -- erwartete Gruppengröße
    phase        TEXT    NOT NULL DEFAULT 'vote'  -- vote | done
  );

  CREATE TABLE IF NOT EXISTS participants (
    id         INTEGER PRIMARY KEY,
    round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,        -- 0 = per „Nicht mehr warten“ übersprungen
    vote       TEXT,                              -- geheime Stimme (JSON), null = noch nicht abgestimmt
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

// ---------- Migration älterer Datenbanken ----------
// Spalten aus Version 1 und 2 (Küchen-Swipen) bleiben liegen, werden aber nicht mehr genutzt.
function addColumns(table, defs) {
  const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const [name, def] of Object.entries(defs)) {
    if (!have.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}
addColumns('rounds', {
  location: "TEXT NOT NULL DEFAULT ''",
  size: 'INTEGER NOT NULL DEFAULT 3',
  phase: "TEXT NOT NULL DEFAULT 'vote'",
});
addColumns('participants', {
  active: 'INTEGER NOT NULL DEFAULT 1',
  vote: 'TEXT',
});

if (db.prepare('PRAGMA user_version').get().user_version < 3) {
  // Bestehende Runden starten neu mit der Abstimmung nach Geschmack.
  db.exec(`
    UPDATE rounds SET phase = 'vote';
    UPDATE participants SET vote = NULL;
    PRAGMA user_version = 3;
  `);
}
