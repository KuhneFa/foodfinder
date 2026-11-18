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
    locked_until INTEGER NOT NULL DEFAULT 0,
    size         INTEGER NOT NULL DEFAULT 3,       -- erwartete Gruppengröße
    phase        TEXT    NOT NULL DEFAULT 'swipe', -- swipe | rank | done
    swipe_round  INTEGER NOT NULL DEFAULT 1,       -- zählt hoch, wenn es kein Match gab
    ideas        TEXT    NOT NULL DEFAULT '[]',    -- eigene Ideen [{ id, label, by }]
    shortlist    TEXT,                             -- Matches (JSON), sobald alle geswipt haben
    prev_tally   TEXT                              -- Ergebnis der letzten Swipe-Runde ohne Match
  );

  CREATE TABLE IF NOT EXISTS participants (
    id         INTEGER PRIMARY KEY,
    round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,         -- 0 = per „Nicht mehr warten“ übersprungen
    swipes     TEXT,                               -- { key: 1 | 0 }
    ranking    TEXT,                               -- [key, …] in der Endrunde
    veto       TEXT,
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

// ---------- Migration von Version 1 (Rangliste statt Swipen) ----------
function addColumns(table, defs) {
  const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const [name, def] of Object.entries(defs)) {
    if (!have.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}
addColumns('rounds', {
  size: 'INTEGER NOT NULL DEFAULT 3',
  phase: "TEXT NOT NULL DEFAULT 'swipe'",
  swipe_round: 'INTEGER NOT NULL DEFAULT 1',
  ideas: "TEXT NOT NULL DEFAULT '[]'",
  shortlist: 'TEXT',
  prev_tally: 'TEXT',
});
addColumns('participants', {
  active: 'INTEGER NOT NULL DEFAULT 1',
  swipes: 'TEXT',
  veto: 'TEXT',
});

if (db.prepare('PRAGMA user_version').get().user_version < 2) {
  // Ranglisten aus Version 1 haben ein anderes Format: zurücksetzen,
  // die Gruppengröße alter Runden aus der Teilnehmerzahl ableiten.
  db.exec(`
    UPDATE participants SET ranking = NULL;
    UPDATE rounds SET size = MAX(2, MIN(10,
      (SELECT COUNT(*) FROM participants p WHERE p.round_id = rounds.id)));
    PRAGMA user_version = 2;
  `);
}
